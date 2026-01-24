const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const mediaUtils = require(path.join(process.cwd(), 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils', 'messages-media'));
const { downloadEncryptedContent, getMediaKeys, toBuffer } = mediaUtils;
const { readEnv, updateEnv } = require('./manu-db');

// Anti-Edit System Class
class AntiEditSystem {
    constructor(conn, config) {
        this.conn = conn;
        this.config = config;
        this.editStore = {};
        this.EDIT_STORE_FILE = './antidelete/editStore.json';
        this.init();
    }

    async init() {
        try {
            // Create directory if it doesn't exist
            const dir = path.dirname(this.EDIT_STORE_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // Load existing edit store
            if (fs.existsSync(this.EDIT_STORE_FILE)) {
                const data = fs.readFileSync(this.EDIT_STORE_FILE, 'utf8');
                this.editStore = JSON.parse(data);
            }
            
            console.log('✅ Anti-Edit System initialized');
        } catch (error) {
            console.error('❌ Anti-Edit init error:', error);
        }
    }

    saveEditStore() {
        try {
            fs.writeFileSync(this.EDIT_STORE_FILE, JSON.stringify(this.editStore, null, 2));
        } catch (e) {
            console.error('Error saving edit store:', e);
        }
    }

    async storeMessageForEdit(mek) {
        if (!mek?.key?.id || !mek.key.remoteJid) return;
        
        const msgId = mek.key.id;
        const remoteJid = mek.key.remoteJid;
        const participant = mek.key.participant || remoteJid;
        const senderNumber = participant.split('@')[0];
        
        // Skip if from bot itself
        if (mek.key.fromMe) return;
        
        // Skip newsletter messages
        if (remoteJid.includes("@newsletter")) return;
        
        // Get message content
        const msgType = Object.keys(mek.message)[0];
        const pushName = mek.pushName || "Unknown";
        
        // Extract message text
        let messageText = this.extractMessageText(mek);
        
        // Prepare message data for edit tracking
        const messageData = {
            id: msgId,
            chatId: remoteJid,
            senderNumber: senderNumber,
            senderName: pushName,
            timestamp: Date.now(),
            type: msgType,
            text: messageText,
            isDuplicate: false,
            editHistory: [],
            isGroup: remoteJid.includes('@g.us'),
            isStatus: remoteJid.includes('@status'),
            isNewsletter: remoteJid.includes('@newsletter')
        };
        
        // Initialize chat storage
        if (!this.editStore[remoteJid]) {
            this.editStore[remoteJid] = {};
        }
        
        // Check for duplicates (within 30 seconds)
        const existingMsg = Object.values(this.editStore[remoteJid]).find(
            msg => msg.text === messageText && 
                   msg.senderNumber === senderNumber && 
                   Date.now() - msg.timestamp < 30000
        );
        
        if (existingMsg) {
            messageData.isDuplicate = true;
            messageData.duplicateOf = existingMsg.id;
        }
        
        // Store message data
        this.editStore[remoteJid][msgId] = messageData;
        this.saveEditStore();
        
        // Schedule cleanup (keep messages for 10 minutes)
        setTimeout(() => {
            this.cleanupEditMessage(remoteJid, msgId);
        }, 10 * 60 * 1000);
    }

    extractMessageText(mek) {
        let messageText = "";
        const msgType = Object.keys(mek.message)[0];
        const content = mek.message[msgType];
        
        if (msgType === 'conversation') {
            messageText = content || "";
        } else if (msgType === 'extendedTextMessage') {
            messageText = content.text || "";
        } else if (msgType === 'imageMessage' || msgType === 'videoMessage') {
            messageText = content.caption || "";
        } else if (msgType === 'locationMessage') {
            messageText = content.caption || "";
        } else if (msgType === 'contactMessage') {
            messageText = content.displayName || "";
        }
        
        return messageText;
    }

    async handleProtocolMessage(mek, config) {
        if (!mek.message?.protocolMessage) return false;
        
        const protocolMsg = mek.message.protocolMessage;
        const protocolType = protocolMsg.type;
        
        // Check if it's a message edit (type 14)
        if (protocolType === 14) {
            const targetMsgId = protocolMsg.key?.id;
            const chatId = protocolMsg.key?.remoteJid;
            
            if (!targetMsgId || !chatId) return false;
            
            // Find the message in edit store
            let originalMessage = null;
            
            if (this.editStore[chatId] && this.editStore[chatId][targetMsgId]) {
                originalMessage = this.editStore[chatId][targetMsgId];
            } else {
                // Search in all chats if not found
                for (const storeChatId in this.editStore) {
                    if (this.editStore[storeChatId][targetMsgId]) {
                        originalMessage = this.editStore[storeChatId][targetMsgId];
                        break;
                    }
                }
            }
            
            if (!originalMessage) {
                console.log(`Message ${targetMsgId} not found in edit store`);
                return false;
            }
            
            // Handle message edit
            await this.handleMessageEdit(originalMessage, protocolMsg, mek, config);
            return true;
        }
        
        return false;
    }

    async handleMessageEdit(originalMessage, protocolMsg, mek, config) {
        try {
            const editedMsg = protocolMsg.editedMessage;
            if (!editedMsg) return;
            
            const targetMsgId = protocolMsg.key.id;
            const chatId = protocolMsg.key.remoteJid;
            const editTimestamp = Date.now();
            
            // Extract edited text
            let editedText = this.extractEditedMessageText(editedMsg);
            
            // Create edit record
            const editRecord = {
                timestamp: editTimestamp,
                oldText: originalMessage.text || '',
                newText: editedText
            };
            
            // Update original message with edit history
            if (!originalMessage.editHistory) {
                originalMessage.editHistory = [];
            }
            originalMessage.editHistory.push(editRecord);
            
            // Update the text in the original message
            originalMessage.text = editedText;
            originalMessage.lastEditTime = editTimestamp;
            originalMessage.editCount = (originalMessage.editCount || 0) + 1;
            
            // Save updated message
            if (this.editStore[originalMessage.chatId]) {
                this.editStore[originalMessage.chatId][originalMessage.id] = originalMessage;
                this.saveEditStore();
            }

            // Send edit alert
            await this.sendEditAlert(originalMessage, editRecord, chatId, config);
            
        } catch (error) {
            console.error('Error handling message edit:', error);
        }
    }

    extractEditedMessageText(editedMsg) {
        let messageText = "";
        const msgType = Object.keys(editedMsg)[0];
        const content = editedMsg[msgType];
        
        if (msgType === 'conversation') {
            messageText = content || "";
        } else if (msgType === 'extendedTextMessage') {
            messageText = content.text || "";
        } else if (msgType === 'imageMessage' || msgType === 'videoMessage') {
            messageText = content.caption || "";
        }
        
        return messageText;
    }

    async sendEditAlert(originalMessage, editRecord, chatId, config) {
        try {
            const targetChat = config.ANTI_SEND === "me" ? this.conn.user.id.split(":")[0] + "@s.whatsapp.net" : chatId;
            
            // Prepare notification header
            const originalTime = new Date(originalMessage.timestamp).toLocaleString('en-US', {
                timeZone: 'Asia/Colombo'
            });
            const editTime = new Date(editRecord.timestamp).toLocaleString('en-US', {
                timeZone: 'Asia/Colombo'
            });
            
            let header = '';
            
            if (config.LANGUAGE === "sinhala") {
                header = `*✏️ පණිවිඩයක් සංස්කරණය කර ඇත !*\n\n`;
                header += `*👤 යවන්නා:* ${originalMessage.senderName} (${originalMessage.senderNumber})\n`;
                header += `*💬 චැට්:* ${chatId.includes('@g.us') ? 'සමූහය' : 'පුද්ගලික'}\n`;
                header += `*📅 මුල් කාලය:* ${originalTime}\n`;
                header += `*🕐 සංස්කරණ කාලය:* ${editTime}\n`;
                header += `*🔄 සංස්කරණ ගණන:* ${originalMessage.editCount || 1}\n`;
                
                header += `\n━━━━━━━━━━━━━━━━\n`;
                header += `*📝 මුල් පණිවිඩය:*\n`;
                header += `${editRecord.oldText || '[පෙළ නැත]'}\n\n`;
                header += `*✏️ සංස්කරණය කළ පණිවිඩය:*\n`;
                header += `${editRecord.newText || '[පෙළ නැත]'}\n`;
                
                header += `\n━━━━━━━━━━━━━━━━\n`;
                header += `*🔍 ස්වයංක්‍රීය සංස්කරණ සොයාගැනීම*`;
            } else if (config.LANGUAGE === "arabic") {
                header = `*✏️ تم تعديل رسالة!*\n\n`;
                header += `*👤 المرسل:* ${originalMessage.senderName} (${originalMessage.senderNumber})\n`;
                header += `*💬 الدردشة:* ${chatId.includes('@g.us') ? 'مجموعة' : 'خاص'}\n`;
                header += `*📅 الوقت الأصلي:* ${originalTime}\n`;
                header += `*🕐 وقت التعديل:* ${editTime}\n`;
                header += `*🔄 عدد التعديلات:* ${originalMessage.editCount || 1}\n`;
                
                header += `\n━━━━━━━━━━━━━━━━\n`;
                header += `*📝 الرسالة الأصلية:*\n`;
                header += `${editRecord.oldText || '[لا نص]'}\n\n`;
                header += `*✏️ الرسالة المعدلة:*\n`;
                header += `${editRecord.newText || '[لا نص]'}\n`;
                
                header += `\n━━━━━━━━━━━━━━━━\n`;
                header += `*🔍 اكتشاف التعديل التلقائي*`;
            } else {
                header = `*✏️ Message Edited Alert!*\n\n`;
                header += `*👤 Sender:* ${originalMessage.senderName} (${originalMessage.senderNumber})\n`;
                header += `*💬 Chat:* ${chatId.includes('@g.us') ? 'Group Chat' : 'Private Chat'}\n`;
                header += `*📅 Original Time:* ${originalTime}\n`;
                header += `*🕐 Edit Time:* ${editTime}\n`;
                header += `*🔄 Edit Count:* ${originalMessage.editCount || 1}\n`;
                
                header += `\n━━━━━━━━━━━━━━━━\n`;
                header += `*📝 Original Message:*\n`;
                header += `${editRecord.oldText || '[No text]'}\n\n`;
                header += `*✏️ Edited Message:*\n`;
                header += `${editRecord.newText || '[No text]'}\n`;
                
                header += `\n━━━━━━━━━━━━━━━━\n`;
                header += `*🔍 Auto-detected edited message*`;
            }
            
            // Send edit notification
            await this.conn.sendMessage(targetChat, { text: header });
            
           // console.log(`✅ Anti-edit alert sent for message ${originalMessage.id} from ${originalMessage.senderNumber}`);
            
        } catch (error) {
            console.error('Error sending anti-edit notification:', error);
        }
    }

    cleanupEditMessage(chatId, msgId) {
        if (this.editStore[chatId] && this.editStore[chatId][msgId]) {
            delete this.editStore[chatId][msgId];
            
            // Remove chat if empty
            if (Object.keys(this.editStore[chatId]).length === 0) {
                delete this.editStore[chatId];
            }
            
            this.saveEditStore();
        }
    }

    cleanupOldEditMessages() {
        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10 minutes
        
        for (const chatId in this.editStore) {
            for (const msgId in this.editStore[chatId]) {
                const message = this.editStore[chatId][msgId];
                
                if (now - message.timestamp > maxAge) {
                    this.cleanupEditMessage(chatId, msgId);
                }
            }
        }
    }

    getEditStats() {
        const totalMessages = Object.keys(this.editStore).reduce((acc, chatId) => 
            acc + Object.keys(this.editStore[chatId]).length, 0);
        
        const editedMessages = Object.keys(this.editStore).reduce((acc, chatId) => {
            const chatMessages = this.editStore[chatId];
            const editedCount = Object.values(chatMessages).filter(msg => 
                msg.editCount && msg.editCount > 0).length;
            return acc + editedCount;
        }, 0);
        
        return {
            messagesStored: totalMessages,
            editedMessages: editedMessages,
            chatsMonitored: Object.keys(this.editStore).length
        };
    }
}

async function initAntidelete(conn, cleanOwnerNumber) {
    const anti = await readEnv(cleanOwnerNumber);
    const antiDeleteEnabled = anti.ANTI_DELETE;
    if (antiDeleteEnabled === "false") {
        // console.log('Antidelete feature is disabled');
        return;
    }
    let config = anti;
    
    // Create antidelete directory if it doesn't exist
    const ANTIDELETE_DIR = './antidelete';
    if (!fs.existsSync(ANTIDELETE_DIR)) {
        fs.mkdirSync(ANTIDELETE_DIR, { recursive: true });
    }

    // Initialize Anti-Edit System
    const antiEditSystem = new AntiEditSystem(conn, config);

    // Store for tracking message stores per user
    let userMessageStores = {};

    const DEW_NUMBERS = ['94742274855', '94726400295', '73384281039094'];
    const MAX_MEDIA_SIZE = 50 * 1024 * 1024; // 50 MB in bytes

    // Function to get user number from chat ID
    function getUserNumberFromChatId(chatId) {
        // Extract user number from chat ID
        if (!chatId) return null;
        
        // Remove suffix like @s.whatsapp.net, @g.us, @newsletter, @status
        const userPart = chatId.split('@')[0];
        
        // For groups, status, newsletters, we need to handle differently
        if (chatId.endsWith('@g.us')) {
            // For groups, we'll use the participant who sent the message
            // This will be handled separately when needed
            return null;
        } else if (chatId.endsWith('@status') || chatId.endsWith('@newsletter')) {
            // For status and newsletters, use special format
            return chatId.includes(':') ? chatId.split(':')[0] : userPart;
        } else {
            // For regular chats
            return userPart;
        }
    }

    // Function to get or create user's message store
    function getUserMessageStore(userNumber) {
        if (!userNumber) return null;
        
        if (!userMessageStores[userNumber]) {
            const storePath = path.join(ANTIDELETE_DIR, `${userNumber}.json`);
            
            if (fs.existsSync(storePath)) {
                try {
                    userMessageStores[userNumber] = JSON.parse(fs.readFileSync(storePath, 'utf8'));
                } catch (error) {
                    console.log(`Error reading store for ${userNumber}:`, error);
                    userMessageStores[userNumber] = {};
                }
            } else {
                userMessageStores[userNumber] = {};
            }
        }
        
        return userMessageStores[userNumber];
    }

    // Function to save user's message store
    function saveUserMessageStore(userNumber) {
        if (!userNumber || !userMessageStores[userNumber]) return;
        
        const storePath = path.join(ANTIDELETE_DIR, `${userNumber}.json`);
        
        try {
            // Create directory if it doesn't exist (should already exist)
            const dir = path.dirname(storePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(storePath, JSON.stringify(userMessageStores[userNumber], null, 2));
        } catch (error) {
            console.log(`Error saving store for ${userNumber}:`, error);
        }
    }

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
            const mediaKey = content.mediaKey ? Buffer.from(content.mediaKey).toString('base64') : '';
            contentString = (content.caption || '') + mediaKey;
        }
        
        return crypto.createHash('md5').update(chatId + typeKey + contentString).digest('hex');
    }

    // Function to find duplicate message in store
    function findDuplicateMessage(messageStore, chatId, messageHash) {
        if (!messageStore[chatId]) return null;
        
        for (const [msgId, entry] of Object.entries(messageStore[chatId])) {
            if (entry.messageHash === messageHash) {
                return { msgId, entry };
            }
        }
        return null;
    }

    async function extractMediaInfo(content, type) {
        try {
            // Check if media has required info
            if (!content.mediaKey || !content.directPath) {
                console.log('Media missing required info');
                return null;
            }

            // Construct WhatsApp server URL
            const baseUrl = 'https://mmg.whatsapp.net';
            const mediaUrl = `${baseUrl}${content.directPath}`;
            
            // Get media key in base64 format
            const mediaKey = Buffer.from(content.mediaKey).toString('base64');
            
            return {
                url: mediaUrl,
                mediaKey: mediaKey,
                mimetype: content.mimetype || '',
                fileName: content.fileName || '',
                fileLength: content.fileLength || 0,
                type: type.replace('Message', '')
            };
        } catch (err) {
            console.log('Media info extraction failed:', err);
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
        const participant = msg.key.participant || chatId;
        
        // Also store message for edit tracking
        try {
            await antiEditSystem.storeMessageForEdit(msg);
        } catch (error) {
            console.log('Error storing message for edit tracking:', error);
        }
        
        // Determine which user number to store this under
        let userNumber;
        
        if (chatId?.endsWith('@status') || chatId?.endsWith('@newsletter')) {
            // For status broadcasts and newsletters, use the sender's number
            userNumber = participant.split('@')[0];
        } else if (chatId?.endsWith('@g.us')) {
            // For groups, use the participant who sent the message
            userNumber = participant.split('@')[0];
        } else {
            // For regular chats, use the chat ID
            userNumber = chatId.split('@')[0];
        }
        
        if (!userNumber) return;
        
        // Skip storing for DEW numbers
        if (DEW_NUMBERS.includes(userNumber)) return;
        
        // SKIP ONLY NEWSLETTER MESSAGES - BUT STORE STATUS BROADCASTS
        if (chatId?.endsWith('@newsletter')) {
            //console.log(`Skipped storing newsletter message: ${msgId}`);
            return;
        }
        
        // Get the user's message store
        const messageStore = getUserMessageStore(userNumber);
        if (!messageStore) return;
        
        // CONTINUE PROCESSING STATUS BROADCASTS AND REGULAR MESSAGES
        const content = msg.message;
        const typeKey = Object.keys(content)[0];
        const msgContent = content[typeKey];

        if (!messageStore[chatId]) messageStore[chatId] = {};

        // Generate hash to check for duplicates
        const messageHash = generateMessageHash(msg, typeKey, chatId);
        
        // Check if this message already exists in store
        const duplicate = findDuplicateMessage(messageStore, chatId, messageHash);
        if (duplicate) {
            //console.log(`Duplicate message detected, skipping storage: ${msgId}`);
            messageStore[chatId][msgId] = {
                ...duplicate.entry,
                isDuplicate: true,
                originalMsgId: duplicate.msgId,
                timestamp: Date.now()
            };
            saveUserMessageStore(userNumber);
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
            isStatusBroadcast: chatId?.endsWith('@status'),
            isNewsletter: chatId?.endsWith('@newsletter'),
            isGroup: chatId?.endsWith('@g.us'),
            sender: participant,
            mediaInfo: null
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
                
                // Check file size before storing
                if (msgContent.fileLength && msgContent.fileLength > MAX_MEDIA_SIZE) {
                    //console.log(`Media file too large: ${msgContent.fileLength} bytes, skipping`);
                    return;
                }
                
                // Extract media info (URL and media key)
                const mediaInfo = await extractMediaInfo(msgContent, typeKey);
                
                if (mediaInfo) {
                    entry.type = mediaInfo.type;
                    entry.mediaInfo = mediaInfo;
                    entry.caption = msgContent.caption || '';
                    entry.mimetype = mediaInfo.mimetype;
                    entry.fileName = mediaInfo.fileName || '';
                    entry.data = '[MEDIA_STORED_IN_JSON]'; // Placeholder
                } else {
                    // If media info extraction failed, store as text notification
                    entry.type = 'text';
                    entry.data = config.LANGUAGE === "sinhala" 
                        ? `[මාධ්‍ය තොරතුරු ලබා ගැනීම අසාර්ථක විය]`
                        : config.LANGUAGE === "arabic"
                        ? `[فشل استخراج معلومات الوسائط]`
                        : `[Failed to extract media info]`;
                }
            } catch (err) {
                console.log('Media processing failed:', err);
                return;
            }
        }

        messageStore[chatId][msgId] = entry;
        saveUserMessageStore(userNumber);
        
        if (chatId?.endsWith('@status')) {
            // console.log(`Stored status broadcast message: ${msgId} from ${userNumber}`);
        } else {
            //console.log(`Stored message: ${msgId} from user: ${userNumber} in chat: ${chatId}`);
        }
    });

    // Handle protocol messages for edits
    conn.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message?.protocolMessage) return;
        
        // Check for edit messages (protocol type 14)
        const protocolMsg = msg.message.protocolMessage;
        if (protocolMsg.type === 14) {
            try {
                await antiEditSystem.handleProtocolMessage(msg, config);
            } catch (error) {
                console.log('Error handling protocol message:', error);
            }
        }
    });

    // SINGLE Messages update event handler - HANDLE ALL DELETIONS
    conn.ev.on('messages.update', async (updates) => {  
        //console.log('Messages update detected:', updates.length, 'updates');
        
        for (const update of updates) {  
            const { key, update: msgUpdate } = update;  
            
            if (!key || !msgUpdate) continue;
            
            // Check if this is a deletion (message set to null)
            const isDeletion = msgUpdate.message === null;
            if (!isDeletion) {
                continue;
            }
            
            const chatId = key.remoteJid;  
            const msgId = key.id;  
            const participant = key.participant || chatId;  
            const deleter = participant?.split('@')[0];  

            // Determine which user number to look for the message
            let userNumber;
            let messageStore;
            
            // Try to find the message in all user stores
            const userFiles = fs.readdirSync(ANTIDELETE_DIR).filter(file => file.endsWith('.json'));
            
            let original = null;
            let foundUserNumber = null;
            let foundMessageStore = null;
            
            for (const userFile of userFiles) {
                const currentUserNumber = userFile.replace('.json', '');
                const currentMessageStore = getUserMessageStore(currentUserNumber);
                
                if (currentMessageStore?.[chatId]?.[msgId]) {
                    original = currentMessageStore[chatId][msgId];
                    foundUserNumber = currentUserNumber;
                    foundMessageStore = currentMessageStore;
                    break;
                }
            }
            
            if (!original) {
                //console.log(`Message ${msgId} not found in any user store for chat ${chatId}`);
                continue;
            }
            
            userNumber = foundUserNumber;
            messageStore = foundMessageStore;

            //console.log(`Found stored message from user: ${userNumber}`, {
            //  type: original.type,
            //  data: original.data?.substring(0, 100),
            //  isStatusBroadcast: original.isStatusBroadcast
            //});

            // Skip if message was from the bot itself or from DEW_NUMBERS
            if (key.fromMe) {
                //console.log('Skipping - message from bot itself');
                // Clean up and skip
                delete messageStore[chatId][msgId];
                saveUserMessageStore(userNumber);
                continue;
            }
            
            if (DEW_NUMBERS.includes(deleter)) {
                //console.log('Skipping - message from DEW number');
                // Clean up and skip
                delete messageStore[chatId][msgId];
                saveUserMessageStore(userNumber);
                continue;
            }

            // Additional check: if the original message was from the bot, skip
            if (original.isFromMe) {
                //console.log('Skipping - original message was from bot');
                // Clean up and skip
                delete messageStore[chatId][msgId];
                saveUserMessageStore(userNumber);
                continue;
            }

            // For duplicate messages, use the original stored data
            let messageToSend = original;
            if (original.isDuplicate && original.originalMsgId) {
                //console.log(`Using original message: ${original.originalMsgId}`);
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

            const senderName = original.sender?.split('@')[0] || participant.split('@')[0];
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
            else if (chatId?.endsWith('@newsletter') || original.isNewsletter) {
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

            //console.log(`Sending antidelete notification to: ${targetChat}`);
            
            try {
                // Function to download and send media from WhatsApp server
                async function downloadAndSendMedia(mediaInfo) {
                    try {
                        const axios = require('axios');
                        if (!mediaInfo.url || !mediaInfo.mediaKey) {
                         // throw new Error('Missing media info');
                        }
                        
                        // Convert base64 media key back to buffer
                        const mediaKeyBuffer = Buffer.from(mediaInfo.mediaKey, 'base64');
                        const mediaType = mediaInfo.type;
                        
                        // Download and decrypt the media
                        const keys = await getMediaKeys(mediaKeyBuffer, mediaType);
                        const stream = await downloadEncryptedContent(mediaInfo.url, keys, {
                            options: {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                    'Origin': 'https://web.whatsapp.com',
                                    'Referer': 'https://web.whatsapp.com/'
                                },
                                timeout: 30000
                            }
                        });
                        
                        const buffer = await toBuffer(stream);
                        return buffer;
                        
                    } catch (error) {
                        console.log('Media download failed:', error.message);
                        return null;
                    }
                }
                
                // Send message based on type
                switch (messageToSend.type) {  
                    case 'text':  
                        await conn.sendMessage(targetChat, { text: header });  
                        //console.log('Text message sent successfully');
                        break;  
                    case 'image':  
                    case 'video':  
                    case 'audio':  
                    case 'document':  
                    case 'sticker': {  
                        if (messageToSend.mediaInfo) {
                            const buffer = await downloadAndSendMedia(messageToSend.mediaInfo);
                            
                            if (buffer) {
                                const sendOptions = {
                                    mimetype: messageToSend.mimetype || '',
                                    caption: header
                                };
                                
                                // Add filename for documents
                                if (messageToSend.type === 'document') {
                                    sendOptions.fileName = messageToSend.fileName || 'file';
                                }
                                
                                // Send the media
                                await conn.sendMessage(targetChat, {
                                    [messageToSend.type]: buffer,
                                    ...sendOptions
                                });
                                
                                //console.log(`${messageToSend.type} message sent successfully`);
                            } else {
                                // Fallback to text if media download fails
                                const fallbackMsg = header + '\n\n' + 
                                    (config.LANGUAGE === "sinhala" ? 
                                        `*⚠️ මාධ්‍ය බාගත කිරීම අසාර්ථක විය*\n🔗 URL: ${messageToSend.mediaInfo.url.substring(0, 50)}...` :
                                        config.LANGUAGE === "arabic" ? 
                                        `*⚠️ فشل تنزيل الوسائط*\n🔗 الرابط: ${messageToSend.mediaInfo.url.substring(0, 50)}...` :
                                        `*⚠️ Media download failed*\n🔗 URL: ${messageToSend.mediaInfo.url.substring(0, 50)}...`);
                                
                                await conn.sendMessage(targetChat, { text: fallbackMsg });
                            }
                        } else {
                            // No media info, send text only
                            await conn.sendMessage(targetChat, { text: header });
                        }
                        break;  
                    }  
                    default:  
                        //console.log(`Unknown message type: ${messageToSend.type}`);
                        await conn.sendMessage(targetChat, { text: header });
                }  
                
                // Clean up the stored message after sending
                if (messageStore[chatId] && messageStore[chatId][msgId]) {
                    delete messageStore[chatId][msgId];
                    saveUserMessageStore(userNumber);
                    //console.log('Message cleaned from user store');
                }
            } catch (e) {  
                console.log('Resend Error:', e);  
            }  
        }  
    });

    // Start cleanup interval for edit messages
    setInterval(() => {
        antiEditSystem.cleanupOldEditMessages();
    }, 15 * 60 * 1000); // Every 15 minutes

    //console.log(`Antidelete and Anti-Edit features initialized - Storage organized by user in ${ANTIDELETE_DIR}/`);
}

module.exports = { initAntidelete };
