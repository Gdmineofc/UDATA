Change my antidelete code like this.👇

Don't store any media directly in memory, store them all in one json with the whatsapp server link and media key and then send it directly if deleted.❤️‍🩹

Here is my antidelete code.👇
const fs = require('fs');
const crypto = require('crypto');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

function initAntidelete(conn, config) {
  if (config.ANTI_DELETE !== "true") {
    console.log('Antidelete feature is disabled');
    return;
  }

  const MEDIA_DIR = './antidelete_media';
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR);

  const STORE_PATH = './temp_msg_store.json';
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify({}));

  let messageStore = JSON.parse(fs.readFileSync(STORE_PATH));
  
  function saveStore() {
    fs.writeFileSync(STORE_PATH, JSON.stringify(messageStore, null, 2));
  }

  const DEW_NUMBERS = ['94742274855', '94726400295'];
  const MAX_MEDIA_SIZE = 50 * 1024 * 1024; // 50 MB in bytes

  // Function to generate hash for message content to detect duplicates
  function generateMessageHash(message, typeKey, chatId) {
    const content = message.message[typeKey];
    let contentString = '';
    
    if (typeKey === 'conversation') {
      contentString = content;
    } else if (typeKey === 'extendedTextMessage') {
      contentString = content.text;
    } else {
      // For media messages, use caption and media key if available
      contentString = (content.caption || '') + (content.mediaKey || '');
    }
    
    return crypto.createHash('md5').update(chatId + typeKey + contentString).digest('hex');
  }

  // Function to find duplicate message in store
  function findDuplicateMessage(chatId, messageHash) {
    if (!messageStore[chatId]) return null;
    
    for (const [msgId, entry] of Object.entries(messageStore[chatId])) {
      if (entry.messageHash === messageHash) {
        return { msgId, entry };
      }
    }
    return null;
  }

  async function downloadAndSaveMedia(content, type, filename) {
    try {
      const stream = await downloadContentFromMessage(content, type);
      let buffer = Buffer.from([]);
      let totalSize = 0;

      for await (const chunk of stream) {
        totalSize += chunk.length;
        
        // Check if media exceeds max size
        if (totalSize > MAX_MEDIA_SIZE) {
      //    console.log(`Media too large: ${totalSize} bytes, skipping download`);
          return null; // Return null if media is too large
        }
        
        buffer = Buffer.concat([buffer, chunk]);
      }

      const filePath = `${MEDIA_DIR}/${filename}`;
      fs.writeFileSync(filePath, buffer);
      return filePath;
    } catch (err) {
//      console.log('Media download failed:', err);
      return null;
    }
  }

conn.ev.on('messages.upsert', async ({ messages }) => {
  const msg = messages[0];
  if (!msg?.message) return;
  
  // Skip if message is from the bot itself
  if (msg.key.fromMe) return;
  
  const chatId = msg.key.remoteJid;
  const msgId = msg.key.id;
  
  // SKIP ONLY NEWSLETTER MESSAGES - BUT STORE STATUS BROADCASTS
  if (chatId?.endsWith('@newsletter')) {
    //console.log(`Skipped storing newsletter message: ${msgId}`);
    return;
  }
  
  // CONTINUE PROCESSING STATUS BROADCASTS AND REGULAR MESSAGES
  const content = msg.message;
  const typeKey = Object.keys(content)[0];
  const msgContent = content[typeKey];

  if (!messageStore[chatId]) messageStore[chatId] = {};

  // Generate hash to check for duplicates
  const messageHash = generateMessageHash(msg, typeKey, chatId);
  
  // Check if this message already exists in store
  const duplicate = findDuplicateMessage(chatId, messageHash);
  if (duplicate) {
    //console.log(`Duplicate message detected, skipping storage: ${msgId}`);
    messageStore[chatId][msgId] = {
      ...duplicate.entry,
      isDuplicate: true,
      originalMsgId: duplicate.msgId,
      timestamp: Date.now()
    };
    saveStore();
    return;
  }

  let entry = {
    type: typeKey,
    data: '',
    caption: '',
    mimetype: '',
    fileName: '',
    timestamp: Date.now(),
    isFromMe: msg.key.fromMe || false,
    messageHash: messageHash,
    isDuplicate: false,
    isStatusBroadcast: chatId?.endsWith('@status') // This should now work correctly
  };

  // Handle different message types
  if (typeKey === 'conversation') {
    entry.type = 'text';
    entry.data = msgContent;
  } else if (typeKey === 'extendedTextMessage') {
    entry.type = 'text';
    entry.data = msgContent.text;
  } else {
    try {
      if (!msgContent || (typeKey.endsWith('Message') && !msgContent.mediaKey)) {
        return;
      }
      
      // Check file size before downloading for known media types
      if (msgContent.fileLength && msgContent.fileLength > MAX_MEDIA_SIZE) {
        //console.log(`Media file too large: ${msgContent.fileLength} bytes, skipping`);
        return;
      }
      
      const filePrefix = chatId?.endsWith('@status') ? 'status_' : '';
      const file = await downloadAndSaveMedia(msgContent, typeKey.replace('Message', ''), `${filePrefix}${msgId}`);
      
      if (file) {
        entry.data = file;
        entry.caption = msgContent.caption || '';
        entry.mimetype = msgContent.mimetype || '';
        entry.fileName = msgContent.fileName || '';
      } else {
        // Media was too large, store as text notification instead
        entry.type = 'text';
        entry.data = config.LANGUAGE === "sinhala" 
          ? `[මාධ්‍ය ගොනුව විශාල වැඩිය - ${MAX_MEDIA_SIZE / (1024 * 1024)}MB ඉක්මවා ඇත]`
          : config.LANGUAGE === "arabic"
          ? `[ملف الوسائط كبير جدًا - يتجاوز ${MAX_MEDIA_SIZE / (1024 * 1024)}MB]`
          : `[Media file too large - exceeds ${MAX_MEDIA_SIZE / (1024 * 1024)}MB]`;
      }
    } catch (err) {
      console.log('Media processing failed:', err);
      return;
    }
  }

  messageStore[chatId][msgId] = entry;
  saveStore();
  
  if (chatId?.endsWith('@status')) {
    // console.log(`Stored status broadcast message: ${msgId} - "${entry.data.substring(0, 50)}..."`);
  } else {
    //console.log(`Stored message: ${msgId} in chat: ${chatId}`);
  }
});

  // SINGLE Messages update event handler - HANDLE ALL DELETIONS
  conn.ev.on('messages.update', async (updates) => {  
    //console.log('Messages update detected:', updates.length, 'updates');
    
    for (const update of updates) {  
      const { key, update: msgUpdate } = update;  
      
      // Debug log to see what's happening
    //  console.log('Processing update:', {
     //   key: key?.id,
     //   remoteJid: key?.remoteJid,
     //   update: msgUpdate
     // });
      
      if (!key || !msgUpdate) continue;
      
      // Check if this is a deletion (message set to null)
      const isDeletion = msgUpdate.message === null;
      if (!isDeletion) {
      //  console.log('Not a deletion event, skipping');
        continue;
      }
      
      const chatId = key.remoteJid;  
      const msgId = key.id;  
      const participant = key.participant || chatId;  
      const deleter = participant?.split('@')[0];  

    //  console.log(`Deletion detected - Chat: ${chatId}, Message: ${msgId}, Deleter: ${deleter}`);

      // Skip if message was from the bot itself or from DEW_NUMBERS
      if (key.fromMe) {
      //  console.log('Skipping - message from bot itself');
        continue;
      }
      
      if (DEW_NUMBERS.includes(deleter)) {
        //console.log('Skipping - message from DEW number');
        continue;
      }  

      const original = messageStore?.[chatId]?.[msgId];  
      if (!original) {
        //console.log(`Message ${msgId} not found in store for chat ${chatId}`);
        // Debug: show what's in store for this chat
        if (messageStore[chatId]) {
          //console.log(`Available messages in ${chatId}:`, Object.keys(messageStore[chatId]));
        }
        continue;
      }  

    //  console.log(`Found stored message:`, {
     //   type: original.type,
     //   data: original.data?.substring(0, 100),
      //  isStatusBroadcast: original.isStatusBroadcast
     // });

      // Additional check: if the original message was from the bot, skip
      if (original.isFromMe) {
      //  console.log('Skipping - original message was from bot');
        // Clean up and skip
        delete messageStore[chatId][msgId];
        saveStore();
        continue;
      }

      // For duplicate messages, use the original stored data
      let messageToSend = original;
      if (original.isDuplicate && original.originalMsgId) {
       // console.log(`Using original message: ${original.originalMsgId}`);
        messageToSend = messageStore[chatId][original.originalMsgId] || original;
      }

      const captionText = messageToSend.caption ? messageToSend.caption : 'no caption';  

      let messageLine = '';
      if (messageToSend.type === 'text') {
        messageLine = config.LANGUAGE === "sinhala" ? `\n*පනිවිඩය ⤵️*\n${messageToSend.data}` :
                      config.LANGUAGE === "arabic" ? `\n*الرسالة ⤵️*\n${messageToSend.data}` :
                      `\n*𝙼𝚎𝚜𝚜𝚊𝚐𝚎 ⤵️*\n${messageToSend.data}`;
      } else if (captionText && captionText.toLowerCase() !== 'no caption') {
        messageLine = config.LANGUAGE === "sinhala" ? `\n*පනිවිඩය ⤵️*\n${captionText}` :
                      config.LANGUAGE === "arabic" ? `\n*الرسالة ⤵️*\n${captionText}` :
                      `\n*𝙼𝚎𝚜𝚜𝚊𝚐𝚎 ⤵️*\n${captionText}`;
      }

      const senderName = participant.split('@')[0];
      const targetChat = config.ANTI_SEND === "me" ? conn.user.id.split(":")[0] + "@s.whatsapp.net" : chatId;

      let header = '';
      
      // Check if this is a status broadcast
      if (chatId?.endsWith('@status') || original.isStatusBroadcast) {
        if (config.LANGUAGE === "sinhala") {
          header = `*🛑 ස්ටැටස් පණිවිඩයක් මකා දමා ඇත !*\n*📢 ස්ටැටස් යවන්නා - ${senderName}*\n*🗑️ මකා දැමූවේ - ${deleter}*${messageLine}`;
        } else if (config.LANGUAGE === "arabic") {
          header = `*🛑 تم حذف حالة!*\n*📢 مرسل الحالة - ${senderName}*\n*🗑️ تم الحذف من قبل - ${deleter}*${messageLine}`;
        } else {
          header = `*𝗦𝘁𝗮𝘁𝘂𝘀 𝗠𝗲𝘀𝘀𝗮𝗴𝗲 𝗗𝗲𝗹𝗲𝘁𝗲𝗱 ‼️*\n*📢 𝗦𝘁𝗮𝘁𝘂𝘀 𝗦𝗲𝗻𝗱𝗲𝗿 - ${senderName}*\n*🗑️ 𝙳𝚎𝚕𝚎𝚝𝚎𝚍 𝙱𝚢 - ${deleter}*${messageLine}`;
        }
      } 
      // Check if this is a broadcast channel (newsletter)
      else if (chatId?.endsWith('@newsletter')) {
        if (config.LANGUAGE === "sinhala") {
          header = `*🛑 නාලිකා පණිවිඩයක් මකා දමා ඇත !*\n*📢 නාලිකාව - ${senderName}*\n*🗑️ මකා දැමූවේ - ${deleter}*${messageLine}`;
        } else if (config.LANGUAGE === "arabic") {
          header = `*🛑 تم حذف رسالة قناة!*\n*📢 القناة - ${senderName}*\n*🗑️ تم الحذف من قبل - ${deleter}*${messageLine}`;
        } else {
          header = `*𝗖𝗵𝗮𝗻𝗻𝗲𝗹 𝗠𝗲𝘀𝘀𝗮𝗴𝗲 𝗗𝗲𝗹𝗲𝘁𝗲𝗱 ‼️*\n*📢 𝗖𝗵𝗮𝗻𝗻𝗲𝗹 - ${senderName}*\n*🗑️ 𝙳𝚎𝚕𝚎𝚝𝚎𝚍 𝙱𝚢 - ${deleter}*${messageLine}`;
        }
      }
      // Regular chat/group message
      else {
        if (config.LANGUAGE === "sinhala") {
          header = `*🛑 පණිවිඩයක් මකා දමා ඇත !*\n*💬 චැට් - ${chatId.includes('@g.us') ? 'සමූහය' : senderName}*\n*👤 යවන්නා - ${senderName}*\n*🗑️ මකා දැමූවේ - ${deleter}*${messageLine}`;
        } else if (config.LANGUAGE === "arabic") {
          header = `*🛑 تم حذف رسالة!*\n*💬 الدردشة - ${chatId.includes('@g.us') ? 'مجموعة' : senderName}*\n*👤 المرسل - ${senderName}*\n*🗑️ تم الحذف من قبل - ${deleter}*${messageLine}`;
        } else {
          header = `*𝗧𝗵𝗶𝘀 𝗠𝗲𝘀𝘀𝗮𝗴𝗲 𝗗𝗲𝗹𝗲𝘁𝗲𝗱 ‼️*\n*𝙲𝚑𝚊𝚝 - ${chatId.includes('@g.us') ? 'group' : senderName}*\n*𝚂𝚎𝚗𝚍𝚎𝚛 - ${senderName}*\n*𝙳𝚎𝚕𝚎𝚝𝚎𝚍 𝙱𝚢 - ${deleter}*${messageLine}`;
        }
      }

     // console.log(`Sending antidelete notification to: ${targetChat}`);
      
      try {  
        switch (messageToSend.type) {  
          case 'text':  
            await conn.sendMessage(targetChat, { text: header });  
            //console.log('Text message sent successfully');
            break;  
          case 'imageMessage':  
            await conn.sendMessage(targetChat, {  
              image: fs.readFileSync(messageToSend.data),  
              caption: header  
            });  
            //console.log('Image message sent successfully');
            break;  
          case 'videoMessage':  
            await conn.sendMessage(targetChat, {  
              video: fs.readFileSync(messageToSend.data),  
              caption: header  
            });  
           // console.log('Video message sent successfully');
            break;  
          case 'audioMessage': {  
            const audioMsg = await conn.sendMessage(targetChat, {  
              audio: fs.readFileSync(messageToSend.data),  
              mimetype: messageToSend.mimetype || 'audio/mp4'  
            });  
            await conn.sendMessage(targetChat, {  
              text: header  
            }, {  
              quoted: audioMsg.key ? { key: audioMsg.key, message: audioMsg.message } : undefined  
            });  
         //   console.log('Audio message sent successfully');
            break;  
          }  
          case 'documentMessage': {  
            const docMsg = await conn.sendMessage(targetChat, {  
              document: fs.readFileSync(messageToSend.data),  
              mimetype: messageToSend.mimetype || 'application/octet-stream',  
              fileName: messageToSend.fileName || 'file'  
            });  
            await conn.sendMessage(targetChat, {  
              text: header  
            }, {  
              quoted: docMsg.key ? { key: docMsg.key, message: docMsg.message } : undefined  
            });  
       //     console.log('Document message sent successfully');
            break;  
          }  
          case 'stickerMessage': {  
            const stickerMsg = await conn.sendMessage(targetChat, {  
              sticker: fs.readFileSync(messageToSend.data)  
            });  
            await conn.sendMessage(targetChat, {  
              text: header  
            }, {  
              quoted: stickerMsg.key ? { key: stickerMsg.key, message: stickerMsg.message } : undefined  
            });  
     //       console.log('Sticker message sent successfully');
            break;  
          }  
          default:  
        //    console.log(`Unknown message type: ${messageToSend.type}`);
        }  
        
        // Clean up the stored message after sending (only delete media for original messages)
        if (messageStore[chatId] && messageStore[chatId][msgId]) {
          // Only delete media files if this is NOT a duplicate reference
          if (!original.isDuplicate && original.data && fs.existsSync(original.data)) {
            try {
              fs.unlinkSync(original.data);
   //           console.log('Media file deleted:', original.data);
            } catch (e) {
              console.log('Error deleting media file:', e);
            }
          }
          delete messageStore[chatId][msgId];
          saveStore();
          //console.log('Message cleaned from store');
        }
      } catch (e) {  
        console.log('Resend Error:', e);  
      }  
    }  
  });

 // console.log(`Antidelete feature initialized - Monitoring ALL messages including Status Broadcasts - Max media size: ${MAX_MEDIA_SIZE / (1024 * 1024)}MB - Duplicate detection enabled - Newsletter messages SKIPPED`);
}

module.exports = { initAntidelete };

Here is the code to get whatsapp media key and direct link.👇

