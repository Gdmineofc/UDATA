gett anti edit messages code on this code

JANITH RASHMIKA:
// antidelete.js
const fs = require('fs-extra');
const path = require('path');
const { downloadContentFromMessage, getContentType } = require('anju-xpro-baileys');

class AntiDeleteSystem {
    constructor(botInstance) {
        this.bot = botInstance;
        this.conn = botInstance.sock;
        this.config = null;
        this.MAX_MEDIA_SIZE = 100 * 1024 * 1024; // 100MB
        this.MESSAGE_STORE_FILE = 'messageStore.json';
        this.MEDIA_DIR = 'antidelete_media';
        this.messageStore = {};
        this.isProcessing = false;
        this.queue = [];
        
        this.init();
    }

    async init() {
        try {
            // Load existing message store
            if (fs.existsSync(this.MESSAGE_STORE_FILE)) {
                const data = await fs.readFile(this.MESSAGE_STORE_FILE, 'utf8');
                this.messageStore = JSON.parse(data);
            }
            
            // Ensure media directory exists
            await fs.ensureDir(this.MEDIA_DIR);
            
            // Start cleanup interval
            this.startCleanupInterval();
            
            console.log(✅ AntiDelete System initialized for ${this.bot.id});
        } catch (error) {
            console.error('❌ AntiDelete init error:', error);
        }
    }

    startCleanupInterval() {
        // Clean old messages every 5 minutes
        setInterval(() => {
            this.cleanupOldMessages();
        }, 5 * 60 * 1000);
    }

    saveStore() {
        try {
            fs.writeFileSync(this.MESSAGE_STORE_FILE, JSON.stringify(this.messageStore, null, 2));
        } catch (e) {
            console.error('Error saving message store:', e);
        }
    }

    async storeMessage(mek) {
        if (!mek?.key?.id  !mek.key.remoteJid) return;
        
        const msgId = mek.key.id;
        const remoteJid = mek.key.remoteJid;
        
        // Skip newsletter messages
        if (remoteJid.includes("@newsletter")) {
            return;
        }
        
        // Skip if from bot itself
        if (mek.key.fromMe) return;
        
        // Extract message content
        const msgType = getContentType(mek.message);
        const sender = mek.key.fromMe 
            ? this.conn.user.id 
            : mek.key.participant  mek.key.remoteJid;
        const senderNumber = sender.split("@")[0];

const pushName = mek.pushName  "Unknown";
        
        // Get message text/caption
        let messageText = this.extractMessageText(mek);
        
        // Prepare message data
        const messageData = {
            id: msgId,
            chatId: remoteJid,
            senderNumber: senderNumber,
            senderName: pushName,
            timestamp: new Date().toISOString(),
            type: msgType,
            text: messageText,
            isDuplicate: false,
            hasMedia: ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(msgType),
            mediaInfo: null,
            editHistory: [] // Store edit history for edited messages
        };
        
        // Initialize chat storage
        if (!this.messageStore[remoteJid]) {
            this.messageStore[remoteJid] = {};
        }
        
        // Check for duplicates
        const existingMsg = Object.values(this.messageStore[remoteJid]).find(
            msg => msg.text === messageText && 
                   msg.senderNumber === senderNumber && 
                   Date.now() - new Date(msg.timestamp).getTime() < 30000
        );
        
        if (existingMsg) {
            messageData.isDuplicate = true;
            messageData.duplicateOf = existingMsg.id;
        }
        
        // Store message data
        this.messageStore[remoteJid][msgId] = messageData;
        
        // Handle media storage for non-duplicates
        if (messageData.hasMedia && !messageData.isDuplicate) {
            try {
                await this.downloadAndStoreMedia(mek, remoteJid, msgId, msgType);
            } catch (mediaError) {
                console.error('Error storing media:', mediaError);
            }
        }
        
        // Save to disk
        this.saveStore();
        
        // Schedule cleanup (keep messages for 10 minutes)
        setTimeout(() => {
            this.cleanupMessage(remoteJid, msgId);
        }, 10 * 60 * 1000);
    }

    extractMessageText(mek) {
        let messageText = "";
        if (mek.message.conversation) {
            messageText = mek.message.conversation;
        } else if (mek.message.imageMessage) {
            messageText = mek.message.imageMessage.caption  "";
        } else if (mek.message.videoMessage) {
            messageText = mek.message.videoMessage.caption  "";
        } else if (mek.message.extendedTextMessage) {
            messageText = mek.message.extendedTextMessage.text  "";
        } else if (mek.message.locationMessage) {
            messageText = mek.message.locationMessage.caption  "";
        } else if (mek.message.liveLocationMessage) {
            messageText = mek.message.liveLocationMessage.caption  "";
        } else if (mek.message.contactMessage) {
            messageText = mek.message.contactMessage.displayName  "";
        } else if (mek.message.buttonsMessage) {
            messageText = mek.message.buttonsMessage.contentText  "";
        } else if (mek.message.templateMessage) {
            messageText = mek.message.templateMessage.hydratedTemplate?.hydratedContentText  "";
        }
        return messageText;
    }

    async downloadAndStoreMedia(mek, chatId, msgId, msgType) {
        try {
            let mediaBuffer;
            let mimeType;
            let fileName;
            
            // Download media based on type
            switch (msgType) {
                case 'imageMessage':
                    const imageStream = await downloadContentFromMessage(
                        mek.message.imageMessage,
                        'image'
                    );
                    mediaBuffer = await this.streamToBuffer(imageStream);
                    mimeType = mek.message.imageMessage.mimetype  'image/jpeg';
                    fileName = image_${msgId}.${this.getExtensionFromMime(mimeType)};
                    break;
                    
                case 'videoMessage':
                    const videoStream = await downloadContentFromMessage(
                        mek.message.videoMessage,

'video'
                    );
                    mediaBuffer = await this.streamToBuffer(videoStream);
                    mimeType = mek.message.videoMessage.mimetype  'video/mp4';
                    fileName = `video_${msgId}.${this.getExtensionFromMime(mimeType)}`;
                    break;
                    
                case 'audioMessage':
                    const audioStream = await downloadContentFromMessage(
                        mek.message.audioMessage,
                        'audio'
                    );
                    mediaBuffer = await this.streamToBuffer(audioStream);
                    mimeType = mek.message.audioMessage.mimetype  'audio/mp4';
                    fileName = audio_${msgId}.${this.getExtensionFromMime(mimeType)};
                    break;
                    
                case 'documentMessage':
                    const docStream = await downloadContentFromMessage(
                        mek.message.documentMessage,
                        'document'
                    );
                    mediaBuffer = await this.streamToBuffer(docStream);
                    mimeType = mek.message.documentMessage.mimetype  'application/octet-stream';
                    fileName = mek.message.documentMessage.fileName  document_${msgId};
                    break;
                    
                case 'stickerMessage':
                    const stickerStream = await downloadContentFromMessage(
                        mek.message.stickerMessage,
                        'sticker'
                    );
                    mediaBuffer = await this.streamToBuffer(stickerStream);
                    mimeType = 'image/webp';
                    fileName = sticker_${msgId}.webp;
                    break;
            }
            
            // Check size limit
            if (mediaBuffer && mediaBuffer.length > this.MAX_MEDIA_SIZE) {
                console.log(Media too large (${mediaBuffer.length} bytes), skipping storage);
                return;
            }
            
            // Save to file
            if (mediaBuffer) {
                const filePath = path.join(this.MEDIA_DIR, fileName);
                await fs.writeFile(filePath, mediaBuffer);
                
                // Update message store with media path
                if (this.messageStore[chatId] && this.messageStore[chatId][msgId]) {
                    this.messageStore[chatId][msgId].data = filePath;
                    this.messageStore[chatId][msgId].mimeType = mimeType;
                    this.messageStore[chatId][msgId].fileName = fileName;
                    this.saveStore();
                }
            }
            
        } catch (error) {
            console.error('Error in downloadAndStoreMedia:', error);
        }
    }

    async streamToBuffer(stream) {
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }

getExtensionFromMime(mimeType) {
        const mimeMap = {
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'video/mp4': 'mp4',
            'video/3gpp': '3gp',
            'audio/mp4': 'm4a',
            'audio/mpeg': 'mp3',
            'audio/ogg': 'ogg',
            'application/pdf': 'pdf'
        };
        return mimeMap[mimeType]  'bin';
    }

    async handleProtocolMessage(mek, config) {
        if (!mek.message?.protocolMessage) return false;
        
        const protocolMsg = mek.message.protocolMessage;
        const protocolType = protocolMsg.type;
        
        // Check if it's a message deletion (type 0) or edit (type 14)
        if (protocolType === 0  protocolType === 14) {
            const targetMsgId = protocolMsg.key?.id;
            const chatId = protocolMsg.key?.remoteJid;
            
            if (!targetMsgId  !chatId) return false;
            
            // Find the message in store
            let originalMessage = null;
            let chatToSearch = chatId;
            
            if (this.messageStore[chatId] && this.messageStore[chatId][targetMsgId]) {
                originalMessage = this.messageStore[chatId][targetMsgId];
                chatToSearch = chatId;
            } else {
                // Search in all chats if not found
                for (const storeChatId in this.messageStore) {
                    if (this.messageStore[storeChatId][targetMsgId]) {
                        originalMessage = this.messageStore[storeChatId][targetMsgId];
                        chatToSearch = storeChatId;
                        break;
                    }
                }
            }
            
            if (!originalMessage) {
                console.log(`Message ${targetMsgId} not found in store for ${protocolType === 0 ? 'deletion' : 'edit'}`);
                return false;
            }
            
            if (protocolType === 0) {
                // Handle message deletion
                await this.sendDeletionAlert(originalMessage, chatToSearch, config);
                this.cleanupMessage(chatToSearch, targetMsgId);
            } else if (protocolType === 14) {
                // Handle message edit
                await this.handleMessageEdit(originalMessage, protocolMsg, mek, config);
            }
            
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
            const editTimestamp = protocolMsg.timestampMs ? new Date(parseInt(protocolMsg.timestampMs.toString())).toISOString() : new Date().toISOString();
            
            // Extract edited text
            let editedText = this.extractEditedMessageText(editedMsg);
            
            // Create edit record
            const editRecord = {
                timestamp: editTimestamp,
                oldText: originalMessage.text,
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
            originalMessage.editCount = (originalMessage.editCount  0) + 1;
            
            // Save updated message
            if (this.messageStore[originalMessage.chatId]) {
                this.messageStore[originalMessage.chatId][originalMessage.id] = originalMessage;
                this.saveStore();
            }

// Send edit alert
            await this.sendEditAlert(originalMessage, editRecord, chatId, config);
            
        } catch (error) {
            console.error('Error handling message edit:', error);
        }
    }

    extractEditedMessageText(editedMsg) {
        let messageText = "";
        if (editedMsg.conversation) {
            messageText = editedMsg.conversation;
        } else if (editedMsg.imageMessage) {
            messageText = editedMsg.imageMessage.caption  "";
        } else if (editedMsg.videoMessage) {
            messageText = editedMsg.videoMessage.caption  "";
        } else if (editedMsg.extendedTextMessage) {
            messageText = editedMsg.extendedTextMessage.text  "";
        }
        return messageText;
    }

    async sendEditAlert(originalMessage, editRecord, chatId, config) {
        try {
            // Get the log chat from config or use bot's DM
            const botNumber = this.conn.user.id.split(":")[0];
            const logChat = config.ANTI_DELETE_LOG  ${botNumber}@s.whatsapp.net;
            
            // Prepare notification header
            const originalTime = new Date(originalMessage.timestamp).toLocaleString('en-US', {
                timeZone: 'Asia/Colombo'
            });
            const editTime = new Date(editRecord.timestamp).toLocaleString('en-US', {
                timeZone: 'Asia/Colombo'
            });
            
            let header = ✏️ *XPROVerce MINI - Message Edit Alert* ✏️\n\n;
            header += 👤 *Sender:* ${originalMessage.senderName} (${originalMessage.senderNumber})\n;
            header += 💬 *Chat:* ${chatId.includes('@g.us') ? 'Group Chat' : 'Private Chat'}\n;
            header += 📅 *Original Time:* ${originalTime}\n;
            header += 🕐 *Edit Time:* ${editTime}\n;
            header += 🔄 *Edit Count:* ${originalMessage.editCount || 1}\n;
            
            header += \n━━━━━━━━━━━━━━━━\n;
            header += 📝 *Original Message:*\n;
            header += ${editRecord.oldText || '[No text]'}\n\n;
            header += ✏️ *Edited Message:*\n;
            header += ${editRecord.newText || '[No text]'}\n;
            
            header += \n━━━━━━━━━━━━━━━━\n;
            header += *🔍 XPROVerce MINI Anti-Edit System*\n;
            header += *Auto-detected edited message*;
            
            // Create kee object for quoted reply
            const kee = {
                key: {
                    remoteJid: "status@broadcast",
                    participant: "0@s.whatsapp.net",
                    fromMe: false,
                    id: "META_AI_FAKE_ID_MOVIE"
                },
                message: {
                    contactMessage: {
                        displayName: config.BOTNAME || "XPROVerce MINI",
                        vcard: `BEGIN:VCARD
VERSION:3.0
N:${config.BOTNAME  "XPROVerce MINI"};;;;;
FN:${config.BOTNAME  "XPROVerce MINI"}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                    }
                }
            };
            
            // Send edit notification
            await this.conn.sendMessage(logChat, { text: header }, { quoted: kee });
            
            console.log(✅ Anti-edit alert sent for message ${originalMessage.id} from ${originalMessage.senderNumber});
            
        } catch (error) {
            console.error('Error sending anti-edit notification:', error);
        }
    }

async sendDeletionAlert(deletedMessage, chatId, config) {
        try {
            // Get the log chat from config or use bot's DM
            const botNumber = this.conn.user.id.split(":")[0];
            const logChat = config.ANTI_DELETE_LOG  `${botNumber}@s.whatsapp.net`;
            
            // Prepare notification header
            const timestamp = new Date(deletedMessage.timestamp).toLocaleString('en-US', {
                timeZone: 'Asia/Colombo'
            });
            
            let header = `🚨 *XPROVerce MINI - Message Deletion Alert* 🚨\n\n`;
            header += `📅 *Time:* ${timestamp}\n`;
            header += `👤 *Sender:* ${deletedMessage.senderName} (${deletedMessage.senderNumber})\n`;
            header += `💬 *Chat:* ${chatId.includes('@g.us') ? 'Group Chat' : 'Private Chat'}\n`;
            
            if (deletedMessage.isDuplicate) {
                header += `⚠️ *Note:* Duplicate message detected\n`;
            }
            
            if (deletedMessage.editCount && deletedMessage.editCount > 0) {
                header += `✏️ *Edit History:* ${deletedMessage.editCount} time(s)\n`;
            }
            
            header += `\n━━━━━━━━━━━━━━━━\n`;
            header += `🗑 *Deleted Content:*\n`;
            
            if (deletedMessage.text) {
                header += `${deletedMessage.text}\n`;
            } else {
                header += `[${deletedMessage.type.replace('Message', '')} message]\n`;
            }
            
            // Show edit history if available
            if (deletedMessage.editHistory && deletedMessage.editHistory.length > 0) {
                header += `\n📋 *Edit History:*\n`;
                deletedMessage.editHistory.forEach((edit, index) => {
                    const editTime = new Date(edit.timestamp).toLocaleString('en-US', {
                        timeZone: 'Asia/Colombo'
                    });
                    header += `${index + 1}. ${editTime}: "${edit.oldText}" → "${edit.newText}"\n`;
                });
            }
            
            header += `\n━━━━━━━━━━━━━━━━\n`;
            header += `*🔍 XPROVerce MINI Antidelete System*\n`;
            header += `*Auto-detected & recovered deleted message*`;
            
            // Create kee object for quoted reply
            const kee = {
                key: {
                    remoteJid: "status@broadcast",
                    participant: "0@s.whatsapp.net",
                    fromMe: false,
                    id: "META_AI_FAKE_ID_MOVIE"
                },
                message: {
                    contactMessage: {
                        displayName: config.BOTNAME  "XPROVerce MINI",
                        vcard: `BEGIN:VCARD
VERSION:3.0
N:${config.BOTNAME  "XPROVerce MINI"};;;;;
FN:${config.BOTNAME  "XPROVerce MINI"}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                    }
                }
            };
            
            // Prepare message to resend
            const messageToSend = {
                type: deletedMessage.type,
                data: deletedMessage.data,
                mimeType: deletedMessage.mimeType,
                fileName: deletedMessage.fileName,
                text: deletedMessage.text
            };
            
            // Send notification
            switch (messageToSend.type) {
                case 'conversation':
                case 'extendedTextMessage':
                    await this.conn.sendMessage(logChat, { text: header }, { quoted: kee });
                    break;
                    
                case 'imageMessage':
                    if (messageToSend.data && fs.existsSync(messageToSend.data)) {
                        await this.conn.sendMessage(logChat, {
                            image: fs.readFileSync(messageToSend.data),
                            caption: header
                        }, { quoted: kee });
                    } else {
                        await this.conn.sendMessage(logChat, {

text: header + \n\n📸 [Image was deleted - File not available]
                        }, { quoted: kee });
                    }
                    break;
                    
                case 'videoMessage':
                    if (messageToSend.data && fs.existsSync(messageToSend.data)) {
                        await this.conn.sendMessage(logChat, {
                            video: fs.readFileSync(messageToSend.data),
                            caption: header
                        }, { quoted: kee });
                    } else {
                        await this.conn.sendMessage(logChat, { 
                            text: header + \n\n🎬 [Video was deleted - File not available]
                        }, { quoted: kee });
                    }
                    break;
                    
                case 'audioMessage':
                    if (messageToSend.data && fs.existsSync(messageToSend.data)) {
                        const audioMsg = await this.conn.sendMessage(logChat, {
                            audio: fs.readFileSync(messageToSend.data),
                            mimetype: messageToSend.mimeType  'audio/mp4'
                        });
                        await this.conn.sendMessage(logChat, {
                            text: header
                        }, { quoted: audioMsg });
                    } else {
                        await this.conn.sendMessage(logChat, { 
                            text: header + `\n\n🎵 [Audio was deleted - File not available]`
                        }, { quoted: kee });
                    }
                    break;
                    
                case 'documentMessage':
                    if (messageToSend.data && fs.existsSync(messageToSend.data)) {
                        const docMsg = await this.conn.sendMessage(logChat, {
                            document: fs.readFileSync(messageToSend.data),
                            mimetype: messageToSend.mimeType  'application/octet-stream',
                            fileName:

messageToSend.fileName  'file'
                        });
                        await this.conn.sendMessage(logChat, {
                            text: header
                        }, { quoted: docMsg });
                    } else {
                        await this.conn.sendMessage(logChat, { 
                            text: header + `\n\n📄 [Document was deleted - File not available]`
                        }, { quoted: kee });
                    }
                    break;
                    
                case 'stickerMessage':
                    if (messageToSend.data && fs.existsSync(messageToSend.data)) {
                        const stickerMsg = await this.conn.sendMessage(logChat, {
                            sticker: fs.readFileSync(messageToSend.data)
                        });
                        await this.conn.sendMessage(logChat, {
                            text: header
                        }, { quoted: stickerMsg });
                    } else {
                        await this.conn.sendMessage(logChat, { 
                            text: header + `\n\n😀 [Sticker was deleted - File not available]`
                        }, { quoted: kee });
                    }
                    break;
                    
                default:
                    await this.conn.sendMessage(logChat, { 
                        text: header + `\n\n📱 [${messageToSend.type} message was deleted]`
                    }, { quoted: kee });
            }
            
            console.log(`✅ Antidelete alert sent for message ${deletedMessage.id} from ${deletedMessage.senderNumber}`);
            
        } catch (error) {
            console.error('Error sending antidelete notification:', error);
        }
    }

    cleanupMessage(chatId, msgId) {
        if (this.messageStore[chatId] && this.messageStore[chatId][msgId]) {
            const message = this.messageStore[chatId][msgId];
            
            // Delete media file if exists
            if (message.data && fs.existsSync(message.data)) {
                try {
                    fs.unlinkSync(message.data);
                } catch (e) {
                    console.log('Error deleting media file:', e);
                }
            }
            
            // Remove from store
            delete this.messageStore[chatId][msgId];
            
            // Remove chat if empty
            if (Object.keys(this.messageStore[chatId]).length === 0) {
                delete this.messageStore[chatId];
            }
            
            this.saveStore();
        }
    }

    cleanupOldMessages() {
        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10 minutes
        
        for (const chatId in this.messageStore) {
            for (const msgId in this.messageStore[chatId]) {
                const message = this.messageStore[chatId][msgId];
                const messageAge = now - new Date(message.timestamp).getTime();
                
                if (messageAge > maxAge) {
                    this.cleanupMessage(chatId, msgId);
                }
            }
        }
        
        // Clean up old media files
        this.cleanupOldMedia();
    }

    cleanupOldMedia() {
        try {
            if (fs.existsSync(this.MEDIA_DIR)) {
                const files = fs.readdirSync(this.MEDIA_DIR);
                const now = Date.now();
                const maxAge = 60 * 60 * 1000; // 1 hour
                
                files.forEach(file => {
                    const filePath = path.join(this.MEDIA_DIR, file);
                    try {
                        const stats = fs.statSync(filePath);
                        const fileAge = now - stats.mtimeMs;
                        
                        // Delete files older than 1 hour
                        if (fileAge > maxAge) {
                            fs.unlinkSync(filePath);
                        }
                    } catch (e) {
                        console.log('Error checking media file:', e);
                    }

});
            }
        } catch (e) {
            console.error('Error cleaning media directory:', e);
        }
    }

    updateConfig(config) {
        this.config = config;
    }

    async processQueue() {
        if (this.isProcessing  this.queue.length === 0) return;
        
        this.isProcessing = true;
        
        try {
            const batch = this.queue.splice(0, 5); // Process 5 at a time
            await Promise.allSettled(
                batch.map(item => this.processQueueItem(item))
            );
        } catch (error) {
            console.error('AntiDelete queue processing error:', error);
        } finally {
            this.isProcessing = false;
            
            // Process next batch if queue has items
            if (this.queue.length > 0) {
                setTimeout(() => this.processQueue(), 100);
            }
        }
    }

    async processQueueItem(item) {
        if (item.type === 'store') {
            await this.storeMessage(item.mek);
        } else if (item.type === 'protocol') {
            await this.handleProtocolMessage(item.mek, item.config);
        }
    }

    addToQueue(type, mek, config = null) {
        this.queue.push({ type, mek, config });
        if (!this.isProcessing) {
            setTimeout(() => this.processQueue(), 50);
        }
    }

    async handleMessage(mek, config) {
        if (!mek?.message) return;
        
        const hasProtocolMessage = mek.message?.protocolMessage;
        
        if (hasProtocolMessage) {
            this.addToQueue('protocol', mek, config);
        } else {
            this.addToQueue('store', mek, config);
        }
    }

    getStats() {
        const totalMessages = Object.keys(this.messageStore).reduce((acc, chatId) => 
            acc + Object.keys(this.messageStore[chatId]).length, 0);
        
        const editedMessages = Object.keys(this.messageStore).reduce((acc, chatId) => {
            const chatMessages = this.messageStore[chatId];
            const editedCount = Object.values(chatMessages).filter(msg => 
                msg.editCount && msg.editCount > 0).length;
            return acc + editedCount;
        }, 0);
        
        return {
            messagesStored: totalMessages,
            editedMessages: editedMessages,
            chatsMonitored: Object.keys(this.messageStore).length,
            queueSize: this.queue.length,
            isProcessing: this.isProcessing,
            mediaDirSize: this.getMediaDirSize()
        };
    }

    getMediaDirSize() {
        try {
            if (!fs.existsSync(this.MEDIA_DIR)) return '0 MB';
            
            let totalSize = 0;
            const files = fs.readdirSync(this.MEDIA_DIR);
            
            files.forEach(file => {
                const filePath = path.join(this.MEDIA_DIR, file);
                try {
                    const stats = fs.statSync(filePath);
                    totalSize += stats.size;
                } catch (e) {
                    console.log('Error getting file size:', e);
                }
            });
            
            return ${(totalSize / (1024 * 1024)).toFixed(2)} MB;
        } catch (e) {
            return 'Error';
        }
    }

    cleanupAll() {
        // Clear all messages
        this.messageStore = {};
        this.saveStore();
        
        // Clear media directory
        try {
            if (fs.existsSync(this.MEDIA_DIR)) {
                fs.emptyDirSync(this.MEDIA_DIR);
            }
        } catch (e) {
            console.error('Error cleaning media directory:', e);
        }
        
        // Clear queue
        this.queue = [];
        
        console.log('✅ AntiDelete/AntiEdit system cleaned up');
    }
}

module.exports = AntiDeleteSystem;


and add it to this my code 👇
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const mediaUtils = require(path.join(process.cwd(), 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils', 'messages-media'));
const { downloadEncryptedContent, getMediaKeys, toBuffer } = mediaUtils;
const { readEnv, updateEnv } = require('./manu-db');

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
                
            //    await conn.sendMessage(targetChat, { text: fallbackMsg });
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

//console.log(`Antidelete feature initialized - Storage organized by user in ${ANTIDELETE_DIR}/`);
}

module.exports = { initAntidelete };

update second my code adding anti edit messages using first code.❤️‍🩹
