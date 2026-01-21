// media-key-downloader.js
const cmd = require('../command').cmd;
// media-key-downloader-fixed.js
const path = require('path');
const { Boom } = require('@hapi/boom');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');

// Import Baileys utilities
const mediaUtils = require(path.join(process.cwd(), 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils', 'messages-media'));

cmd({
    pattern: "getmediafull",
    desc: "Extract media key AND download/send media from WhatsApp links",
    category: "media",
    usage: "/getmediafull [quote media message or provide URL]",
    filename: __filename
},
async(conn, mek, m, {from, reply, quoted, body, pushname}) => {
    try {
        const logger = conn.logger || console;
        const { downloadEncryptedContent, getMediaKeys, toBuffer } = mediaUtils;
        
        let mediaUrl = '';
        let mediaKey = null;
        let mediaType = 'video';
        let mimetype = 'video/mp4';
        let processingMsg = null;
        
        // Function to update progress
        const updateProgress = async (text) => {
            if (processingMsg) {
                // Edit existing message
                await conn.sendMessage(from, {
                    text: text,
                    edit: processingMsg.key
                });
            } else {
                // Send new message
                processingMsg = await reply(text);
            }
            return processingMsg;
        };
        
        // Function to extract media info from message
        const extractMediaData = (message) => {
            const mediaTypes = [
                'videoMessage',
                'imageMessage',
                'audioMessage',
                'documentMessage',
                'stickerMessage'
            ];
            
            for (const type of mediaTypes) {
                if (message[type]) {
                    const media = message[type];
                    return {
                        type: type.replace('Message', ''),
                        media: media,
                        url: media.url || (media.directPath ? `https://mmg.whatsapp.net${media.directPath}` : null),
                        mediaKey: media.mediaKey,
                        mimetype: media.mimetype,
                        fileLength: media.fileLength,
                        caption: media.caption,
                        filename: `whatsapp_${Date.now()}.${getExtension(media.mimetype)}`
                    };
                }
            }
            
            // Check quoted message
            if (message.extendedTextMessage?.contextInfo?.quotedMessage) {
                return extractMediaData(message.extendedTextMessage.contextInfo.quotedMessage);
            }
            
            return null;
        };
        
        // Parse URL from text if provided
        const parseUrlFromText = (text) => {
            const urlRegex = /https?:\/\/[^\s]+/g;
            const matches = text.match(urlRegex);
            return matches ? matches[0] : null;
        };
        
        // Check different sources for media data
        let mediaData = null;
        
        // 1. Check if user provided URL in command
        if (body && body.trim()) {
            const urlFromText = parseUrlFromText(body);
            if (urlFromText) {
                mediaUrl = urlFromText;
                // Try to get media key from quoted message
                if (quoted && quoted.message) {
                    mediaData = extractMediaData(quoted.message);
                    if (mediaData?.mediaKey) {
                        mediaKey = mediaData.mediaKey;
                        mediaType = mediaData.type;
                        mimetype = mediaData.mimetype;
                    }
                }
            }
        }
        
        // 2. Check quoted message
        if (!mediaData && quoted && quoted.message) {
            mediaData = extractMediaData(quoted.message);
            if (mediaData) {
                mediaUrl = mediaData.url;
                mediaKey = mediaData.mediaKey;
                mediaType = mediaData.type;
                mimetype = mediaData.mimetype;
            }
        }
        
        // 3. Check current message
        if (!mediaData) {
            mediaData = extractMediaData(m.message);
            if (mediaData) {
                mediaUrl = mediaData.url;
                mediaKey = mediaData.mediaKey;
                mediaType = mediaData.type;
                mimetype = mediaData.mimetype;
            }
        }
        
        // If no URL found, show help
        if (!mediaUrl) {
            const helpMsg = `📥 *WhatsApp Media Downloader*\n\n` +
                          `*Usage:*\n` +
                          `1. Quote a media message and use /getmediafull\n` +
                          `2. Or: /getmediafull <whatsapp-url>\n\n` +
                          `*Example with your URL:*\n` +
                          `\`/getmediafull https://mmg.whatsapp.net/v/t62.7161-24/534526674_645658648608654_3696575190134551904_n.enc?...\`\n\n` +
                          `*What this does:*\n` +
                          `• Extracts media key from message\n` +
                          `• Downloads from WhatsApp URL\n` +
                          `• Decrypts if needed\n` +
                          `• Sends media to you`;
            
            return reply(helpMsg);
        }
        
        // Check if it's a WhatsApp URL
        const isWhatsAppUrl = mediaUrl.includes('whatsapp.net');
        const isEncrypted = mediaUrl.includes('.enc') || mediaUrl.includes('enc?');
        
        // Start processing
        processingMsg = await updateProgress(`🔍 *Processing Media*\n\n` +
                                           `🔗 URL: ${mediaUrl.substring(0, 60)}${mediaUrl.length > 60 ? '...' : ''}\n` +
                                           `📊 Type: ${mediaType.toUpperCase()}\n` +
                                           `🔒 Encrypted: ${isEncrypted ? '✅ Yes' : '❌ No'}\n` +
                                           `🔑 Media Key: ${mediaKey ? '✅ Found' : '❌ Missing'}\n` +
                                           `⚡ Source: ${isWhatsAppUrl ? 'WhatsApp' : 'Regular'}\n` +
                                           `⏳ Step 1/3: Extracting data...`);
        
        // Step 1: Show media key if available
        let keyInfo = '';
        if (mediaKey) {
            const mediaKeyBase64 = Buffer.from(mediaKey).toString('base64');
            const mediaKeyHex = Buffer.from(mediaKey).toString('hex');
            
            keyInfo = `🔐 *Media Key Extracted*\n\n` +
                     `*Base64:*\n\`\`\`${mediaKeyBase64}\`\`\`\n\n` +
                     `*Hex (first 32):*\n\`${mediaKeyHex.substring(0, 32)}\`\n` +
                     `*Key Length:* ${mediaKey.length} bytes\n\n`;
                     
            // Send key info separately
            await conn.sendMessage(from, {
                text: keyInfo + `📋 *Save this key for future use!*`
            }, { quoted: mek });
            
            await updateProgress(`✅ Step 1/3: Key extracted\n⏳ Step 2/3: Downloading media...`);
        } else if (isEncrypted) {
            await updateProgress(`⚠️ Step 1/3: No media key found for encrypted content\n⏳ Trying direct download...`);
        } else {
            await updateProgress(`✅ Step 1/3: Media info extracted\n⏳ Step 2/3: Downloading...`);
        }
        
        // Step 2: Download the media
        try {
            let buffer;
            
            if (isEncrypted && mediaKey) {
                // Download and decrypt encrypted WhatsApp media
                await updateProgress(`🔐 Step 2/3: Decrypting media...`);
                
                const keys = await getMediaKeys(mediaKey, mediaType);
                const stream = await downloadEncryptedContent(mediaUrl, keys, {
                    options: {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Origin': 'https://web.whatsapp.com',
                            'Referer': 'https://web.whatsapp.com/'
                        },
                        timeout: 120000
                    }
                });
                
                buffer = await toBuffer(stream);
                
            } else if (isWhatsAppUrl) {
                // Try direct download from WhatsApp
                await updateProgress(`📥 Step 2/3: Downloading from WhatsApp...`);
                
                const response = await axios({
                    url: mediaUrl,
                    method: 'GET',
                    responseType: 'stream',
                    timeout: 120000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Origin': 'https://web.whatsapp.com',
                        'Referer': 'https://web.whatsapp.com/'
                    }
                });
                
                buffer = await toBuffer(response.data);
                
            } else {
                // Regular URL download
                await updateProgress(`📥 Step 2/3: Downloading from URL...`);
                
                const response = await axios({
                    url: mediaUrl,
                    method: 'GET',
                    responseType: 'stream',
                    timeout: 60000
                });
                
                buffer = await toBuffer(response.data);
            }
            
            await updateProgress(`✅ Step 2/3: Downloaded ${formatBytes(buffer.length)}\n⏳ Step 3/3: Sending media...`);
            
            // Step 3: Send the media
            const sendOptions = {
                mimetype: mimetype,
                filename: mediaData?.filename || `whatsapp_media_${Date.now()}.${getExtension(mimetype)}`,
                caption: mediaData?.caption || `📤 Downloaded by ${pushname}\n🔗 From: ${mediaUrl.substring(0, 30)}...`
            };
            
            // Add type-specific options
            if (mediaType === 'video') {
                sendOptions.seconds = mediaData?.media?.seconds || 0;
                if (mediaData?.media?.width && mediaData?.media?.height) {
                    sendOptions.width = mediaData.media.width;
                    sendOptions.height = mediaData.media.height;
                }
            }
            
            if (mediaType === 'audio') {
                sendOptions.ptt = mediaData?.media?.ptt || false;
            }
            
            await conn.sendMessage(from, {
                [mediaType]: buffer,
                ...sendOptions
            }, { quoted: mek });
            
            // Success message
            let successMsg = `✅ *Media Successfully Processed!*\n\n`;
            successMsg += `📊 Type: ${mediaType.toUpperCase()}\n`;
            successMsg += `💾 Size: ${formatBytes(buffer.length)}\n`;
            successMsg += `🔒 Status: ${isEncrypted ? (mediaKey ? 'Decrypted ✅' : 'Encrypted (no key) ❌') : 'Normal ✅'}\n`;
            successMsg += `🔑 Key Used: ${mediaKey ? '✅ Yes' : '❌ No'}\n`;
            successMsg += `👤 Processed by: ${pushname}\n`;
            successMsg += `🕒 Time: ${new Date().toLocaleTimeString()}\n\n`;
            
            if (mediaKey && isEncrypted) {
                const mediaKeyBase64 = Buffer.from(mediaKey).toString('base64');
                successMsg += `🔐 *Media Key (Base64):*\n\`${mediaKeyBase64.substring(0, 30)}...\`\n\n`;
                successMsg += `📋 *To reuse:*\n`;
                successMsg += `\`/sendmedia ${mediaUrl.split('?')[0].substring(0, 30)}... --key=${mediaKeyBase64.substring(0, 20)}...\``;
            }
            
            await reply(successMsg);
            
        } catch (downloadError) {
            console.error('Download error:', downloadError);
            
            let errorMsg = `❌ *Download Failed*\n\n`;
            errorMsg += `*Error:* ${downloadError.message}\n\n`;
            
            if (isEncrypted && !mediaKey) {
                errorMsg += `🔐 *ENCRYPTED CONTENT*\n`;
                errorMsg += `This media is encrypted (.enc) but no media key was found.\n\n`;
                errorMsg += `*Solutions:*\n`;
                errorMsg += `1. Quote the ORIGINAL message (not forward)\n`;
                errorMsg += `2. Use /getkey on the original message first\n`;
                errorMsg += `3. Get base64 key, then use:\n`;
                errorMsg += `\`/sendmedia ${mediaUrl.substring(0, 30)}... --key=BASE64_KEY\``;
            } else if (downloadError.response?.status === 403) {
                errorMsg += `🚫 *Access Denied*\n`;
                errorMsg += `• URL might require authentication\n`;
                errorMsg += `• Server blocked the request\n`;
                errorMsg += `• Try different network/VPN`;
            } else if (downloadError.response?.status === 404) {
                errorMsg += `❌ *Not Found*\n`;
                errorMsg += `• Media has been deleted\n`;
                errorMsg += `• URL is expired\n`;
                errorMsg += `• Invalid link`;
            } else if (downloadError.code === 'ECONNREFUSED') {
                errorMsg += `🌐 *Connection Failed*\n`;
                errorMsg += `• Server is down\n`;
                errorMsg += `• Network issue\n`;
                errorMsg += `• Try again later`;
            }
            
            // Still send the media key info if we have it
            if (mediaKey) {
                const mediaKeyBase64 = Buffer.from(mediaKey).toString('base64');
                errorMsg += `\n\n🔑 *Media Key Extracted:*\n\`${mediaKeyBase64.substring(0, 30)}...\`\n`;
                errorMsg += `You can try with another tool using this key.`;
            }
            
            await reply(errorMsg);
        }
        
    } catch (error) {
        console.error("Error in getmediafull command:", error);
        await reply(`❌ Critical error: ${error.message}\n\nPlease try:\n1. Quote the original message\n2. Make sure URL is valid\n3. Check your connection`);
    }
});

// Alternative version without message editing (simpler)
cmd({
    pattern: "dlmediafull",
    desc: "Download media with key extraction (simple version)",
    category: "media",
    filename: __filename
},
async(conn, mek, m, {from, reply, quoted, pushname}) => {
    try {
        const { downloadEncryptedContent, getMediaKeys, toBuffer } = mediaUtils;
        
        // Get message
        const message = quoted?.message || m.message;
        
        // Extract media data
        let mediaData = null;
        let mediaKey = null;
        let mediaUrl = '';
        let mediaType = 'video';
        let mimetype = 'video/mp4';
        
        // Check for media
        const mediaTypes = ['videoMessage', 'imageMessage', 'audioMessage', 'documentMessage'];
        for (const type of mediaTypes) {
            if (message[type]) {
                const media = message[type];
                mediaData = media;
                mediaKey = media.mediaKey;
                mediaUrl = media.url || `https://mmg.whatsapp.net${media.directPath}`;
                mediaType = type.replace('Message', '');
                mimetype = media.mimetype;
                break;
            }
        }
        
        if (!mediaData) {
            return reply("❌ No media found. Please quote or send a media message.");
        }
        
        if (!mediaUrl) {
            return reply("❌ No URL found in media message.");
        }
        
        // Send initial message
        await reply(`📥 Processing ${mediaType}...\n🔗 ${mediaUrl.substring(0, 50)}...`);
        
        // Download media
        let buffer;
        const isEncrypted = mediaUrl.includes('.enc');
        
        if (mediaKey) {
            // Decrypt encrypted media
            const keys = await getMediaKeys(mediaKey, mediaType);
            const stream = await downloadEncryptedContent(mediaUrl, keys, {
                options: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0',
                        'Origin': 'https://web.whatsapp.com'
                    }
                }
            });
            buffer = await toBuffer(stream);
        } else {
            // Regular download
            const response = await axios({
                url: mediaUrl,
                method: 'GET',
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Origin': 'https://web.whatsapp.com'
                }
            });
            buffer = await toBuffer(response.data);
        }
        
        // Send media key info
        if (mediaKey) {
            const base64Key = Buffer.from(mediaKey).toString('base64');
            await conn.sendMessage(from, {
                text: `🔑 *Media Key Extracted:*\n\`\`\`${base64Key}\`\`\`\n\n*Use with:*\n\`/sendmedia ${mediaUrl.substring(0, 30)}... --key=${base64Key.substring(0, 20)}...\``
            }, { quoted: mek });
        }
        
        // Send the media
        const filename = `whatsapp_${Date.now()}.${getExtension(mimetype)}`;
        const sendOpts = { mimetype, filename };
        
        if (mediaType === 'video') {
            sendOpts.seconds = mediaData.seconds || 0;
        }
        if (mediaType === 'audio') {
            sendOpts.ptt = mediaData.ptt || false;
        }
        
        await conn.sendMessage(from, {
            [mediaType]: buffer,
            ...sendOpts,
            caption: `📤 Downloaded by ${pushname}\n🔗 ${mediaUrl.substring(0, 40)}...`
        }, { quoted: mek });
        
        // Send success message
        let successMsg = `✅ *Download Complete!*\n\n`;
        successMsg += `📊 Type: ${mediaType.toUpperCase()}\n`;
        successMsg += `💾 Size: ${formatBytes(buffer.length)}\n`;
        successMsg += `🔒 Status: ${isEncrypted ? (mediaKey ? 'Decrypted' : 'Encrypted (no key)') : 'Normal'}\n`;
        successMsg += `👤 By: ${pushname}`;
        
        await reply(successMsg);
        
    } catch (error) {
        console.error("Error in dlmediafull:", error);
        await reply(`❌ Error: ${error.message}`);
    }
});

// Helper functions
function getExtension(mimetype) {
    if (!mimetype) return 'bin';
    
    const mimeMap = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/3gp': '3gp',
        'video/quicktime': 'mov',
        'audio/mpeg': 'mp3',
        'audio/ogg': 'ogg',
        'audio/wav': 'wav',
        'application/pdf': 'pdf',
        'application/octet-stream': 'bin'
    };
    
    return mimeMap[mimetype] || mimetype.split('/')[1]?.split(';')[0] || 'bin';
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

module.exports = {
    getExtension,
    formatBytes
};









const {cmd , commands} = require('../command');
const { getBuffer, getGroupAdmins, getRandom, h2k, isUrl, Json, runtime, sleep, fetchJson} = require('../lib/functions')
const { readEnv, updateEnv } = require('../manu-db');
// media-from-link.js
// media-from-link-fixed.js
const path = require('path');
const { Boom } = require('@hapi/boom');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const { Readable } = require('stream');

// Import Baileys utilities
const mediaUtils = require(path.join(process.cwd(), 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils', 'messages-media'));
// get-media-key.js

cmd({
    pattern: "getkey",
    desc: "Extract media key from any media message",
    category: "media",
    filename: __filename
},
async(conn, mek, m, {from, reply, quoted, body, pushname}) => {
    try {
        // Get the message to analyze
        let message = m.message;
        
        // Check if quoted message exists
        if (quoted && quoted.message) {
            message = quoted.message;
        }
        
        // Function to extract media info from message
        const extractMediaInfo = (msg) => {
            const mediaTypes = [
                'imageMessage',
                'videoMessage', 
                'audioMessage',
                'documentMessage',
                'stickerMessage'
            ];
            
            for (const type of mediaTypes) {
                if (msg[type]) {
                    const media = msg[type];
                    return {
                        type: type.replace('Message', ''),
                        media,
                        hasMediaKey: !!media.mediaKey,
                        mediaKey: media.mediaKey,
                        mimetype: media.mimetype,
                        fileLength: media.fileLength,
                        directPath: media.directPath,
                        url: media.url,
                        fileSha256: media.fileSha256
                    };
                }
            }
            
            // Check quoted message in extended text
            if (msg.extendedTextMessage && 
                msg.extendedTextMessage.contextInfo && 
                msg.extendedTextMessage.contextInfo.quotedMessage) {
                return extractMediaInfo(msg.extendedTextMessage.contextInfo.quotedMessage);
            }
            
            return null;
        };
        
        // Extract media info
        const mediaInfo = extractMediaInfo(message);
        
        if (!mediaInfo) {
            return reply("❌ No media found in this message. Please quote or send a media message.");
        }
        
        if (!mediaInfo.hasMediaKey) {
            return reply("❌ This media doesn't have a media key. It might not be encrypted or is from an old message.");
        }
        
        // Convert media key to different formats
        const mediaKeyBuffer = mediaInfo.mediaKey;
        const mediaKeyBase64 = Buffer.from(mediaKeyBuffer).toString('base64');
        const mediaKeyHex = Buffer.from(mediaKeyBuffer).toString('hex');
        
        // Get direct URL
        const directUrl = mediaInfo.url || (mediaInfo.directPath ? `https://mmg.whatsapp.net${mediaInfo.directPath}` : 'N/A');
        
        // Create information message
        let info = `🔐 *Media Key Extracted*\n\n`;
        info += `📊 *Media Type:* ${mediaInfo.type.toUpperCase()}\n`;
        info += `📄 *MIME Type:* ${mediaInfo.mimetype || 'Unknown'}\n`;
        info += `🔗 *Direct URL:*\n\`\`\`${directUrl}\`\`\`\n\n`;
        
        info += `🔑 *MEDIA KEY (Base64):*\n\`\`\`${mediaKeyBase64}\`\`\`\n\n`;
        
        info += `📋 *Other Formats:*\n`;
        info += `• *Hex:* \`${mediaKeyHex.substring(0, 32)}...\`\n`;
        info += `• *Length:* ${mediaKeyBuffer.length} bytes\n`;
        info += `• *File SHA256:* ${mediaInfo.fileSha256 ? 'Available' : 'N/A'}\n`;
        
        info += `\n📥 *How to Use:*\n`;
        info += `1. Copy the Base64 key above\n`;
        info += `2. Use with /sendmedia command:\n`;
        info += `\`/sendmedia ${directUrl.substring(0, 50)}... --key=${mediaKeyBase64.substring(0, 20)}...\`\n`;
        
        info += `\n⚠️ *Important:*\n`;
        info += `• Media keys expire after some time\n`;
        info += `• Each media has unique key\n`;
        info += `• Keep key secure\n`;
        info += `• Works only with original media`;
        
        // Send the info
        await reply(info);
        
        // Also send as a file for easy copying
        if (mediaKeyBase64.length < 1000) { // Don't send if too long
            await conn.sendMessage(from, {
                document: Buffer.from(mediaKeyBase64),
                fileName: `media_key_${Date.now()}.txt`,
                mimetype: 'text/plain',
                caption: `📋 Media Key for ${mediaInfo.type}\n👤 Extracted by ${pushname}`
            }, { quoted: mek });
        }
        
    } catch (error) {
        console.error("Error in getkey command:", error);
        await reply(`❌ Error extracting media key: ${error.message}`);
    }
});
const createMediaFromLink = (sock, logger) => {
    const { 
        getHttpStream,
        toBuffer,
        encryptedStream,
        prepareStream,
        getWAUploadToServer,
        downloadEncryptedContent,
        downloadContentFromMessage,
        getMediaKeys,
        getUrlFromDirectPath
    } = mediaUtils;

    /**
     * Download from WhatsApp encrypted URL with proper authentication
     * @param {String} url - WhatsApp encrypted URL
     * @param {Buffer} mediaKey - Media key for decryption
     * @param {String} mediaType - Type of media
     * @returns {Buffer} Decrypted media buffer
     */
    const downloadEncryptedWhatsAppMedia = async (url, mediaKey, mediaType = 'video') => {
        try {
            if (logger) {
                logger.debug(`Downloading encrypted WhatsApp media: ${url.substring(0, 50)}...`);
            }

            if (!mediaKey) {
                throw new Boom('Media key is required for encrypted WhatsApp content', { statusCode: 400 });
            }

            // Get media keys for decryption
            const keys = await getMediaKeys(mediaKey, mediaType);
            
            // Download and decrypt content
            const stream = await downloadEncryptedContent(url, keys, {
                options: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': '*/*',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Origin': 'https://web.whatsapp.com',
                        'Referer': 'https://web.whatsapp.com/',
                        'Sec-Fetch-Dest': 'empty',
                        'Sec-Fetch-Mode': 'cors',
                        'Sec-Fetch-Site': 'cross-site'
                    },
                    timeout: 90000,
                    maxContentLength: 200 * 1024 * 1024
                }
            });

            const buffer = await toBuffer(stream);
            
            if (logger) {
                logger.debug(`Successfully decrypted ${buffer.length} bytes`);
            }
            
            return buffer;
        } catch (error) {
            if (logger) {
                logger.error({ error, url: url.substring(0, 100) }, 'Failed to download encrypted WhatsApp media');
            }
            
            if (error.message.includes('decryption')) {
                throw new Boom('Failed to decrypt media. Invalid media key or corrupted data.', { 
                    statusCode: 400,
                    data: { requiresMediaKey: true }
                });
            }
            
            throw new Boom(`Failed to download encrypted media: ${error.message}`, {
                statusCode: error.response?.status || 500,
                data: { requiresMediaKey: true }
            });
        }
    };

    /**
     * Download from regular WhatsApp URL (non-encrypted)
     */
    const downloadRegularWhatsAppMedia = async (url, options = {}) => {
        try {
            if (logger) {
                logger.debug(`Downloading regular WhatsApp media: ${url.substring(0, 50)}...`);
            }

            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                timeout: options.timeout || 60000,
                maxContentLength: options.maxSize || 100 * 1024 * 1024,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Origin': 'https://web.whatsapp.com',
                    'Referer': 'https://web.whatsapp.com/',
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'cross-site',
                    ...options.headers
                }
            });

            const buffer = await toBuffer(response.data);
            
            if (logger) {
                logger.debug(`Downloaded ${buffer.length} bytes from WhatsApp`);
            }
            
            return buffer;
        } catch (error) {
            if (logger) {
                logger.error({ error, url: url.substring(0, 100) }, 'Failed to download WhatsApp media');
            }
            
            if (error.response?.status === 403) {
                throw new Boom('Access forbidden. URL might require authentication or is blocked.', { 
                    statusCode: 403 
                });
            }
            
            if (error.response?.status === 404) {
                throw new Boom('Media not found. URL might be expired.', { 
                    statusCode: 404 
                });
            }
            
            throw new Boom(`Failed to download media: ${error.message}`, {
                statusCode: error.response?.status || 500
            });
        }
    };

    /**
     * Smart URL downloader
     */
    const downloadFromUrl = async (url, options = {}) => {
        const isEncrypted = url.includes('.enc') || url.includes('enc?');
        const isWhatsApp = url.includes('whatsapp.net');
        
        if (isEncrypted && options.mediaKey) {
            const mediaKey = Buffer.isBuffer(options.mediaKey) ? options.mediaKey : Buffer.from(options.mediaKey, 'base64');
            return downloadEncryptedWhatsAppMedia(url, mediaKey, options.mediaType || 'video');
        } else if (isWhatsApp) {
            return downloadRegularWhatsAppMedia(url, options);
        } else {
            // Regular URL download
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                timeout: options.timeout || 30000,
                maxContentLength: options.maxSize || 100 * 1024 * 1024
            });
            return toBuffer(response.data);
        }
    };

    /**
     * Parse URL and extract information
     */
    const parseWhatsAppUrl = (url) => {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop();
            
            // Detect media type from filename
            let mediaType = 'video'; // Default for .enc files
            let mimetype = 'video/mp4';
            let extension = 'mp4';
            
            if (filename.includes('.jpg') || filename.includes('.jpeg')) {
                mediaType = 'image';
                mimetype = 'image/jpeg';
                extension = 'jpg';
            } else if (filename.includes('.png')) {
                mediaType = 'image';
                mimetype = 'image/png';
                extension = 'png';
            } else if (filename.includes('.gif')) {
                mediaType = 'image';
                mimetype = 'image/gif';
                extension = 'gif';
            } else if (filename.includes('.mp3') || filename.includes('.ogg') || filename.includes('.wav')) {
                mediaType = 'audio';
                mimetype = 'audio/mpeg';
                extension = 'mp3';
            } else if (filename.includes('.pdf')) {
                mediaType = 'document';
                mimetype = 'application/pdf';
                extension = 'pdf';
            }
            
            // Check if encrypted
            const isEncrypted = filename.includes('.enc') || url.includes('.enc?');
            
            return {
                url,
                hostname: urlObj.hostname,
                pathname,
                filename,
                isEncrypted,
                mediaType,
                mimetype,
                extension,
                suggestedFilename: `whatsapp_${Date.now()}.${extension}`,
                params: Object.fromEntries(urlObj.searchParams)
            };
        } catch (error) {
            // Fallback parsing
            const isEncrypted = url.includes('.enc');
            return {
                url,
                isEncrypted,
                mediaType: 'video',
                mimetype: 'video/mp4',
                extension: 'mp4',
                suggestedFilename: `whatsapp_media_${Date.now()}.mp4`
            };
        }
    };

    /**
     * Send media with automatic type detection
     */
    const sendMediaFromUrl = async (to, url, options = {}) => {
        try {
            const parsed = parseWhatsAppUrl(url);
            
            if (logger) {
                logger.debug(`Sending media: ${parsed.mediaType} from ${url.substring(0, 50)}...`);
            }
            
            // Download media
            const buffer = await downloadFromUrl(url, {
                mediaKey: options.mediaKey,
                mediaType: parsed.mediaType,
                timeout: options.timeout || 90000,
                maxSize: options.maxSize || 100 * 1024 * 1024,
                ...options
            });
            
            // Prepare send options
            const sendOptions = {
                mimetype: options.mimetype || parsed.mimetype,
                filename: options.filename || parsed.suggestedFilename,
                caption: options.caption || '',
                ...options.sendOptions
            };
            
            // Add type-specific options
            if (parsed.mediaType === 'video') {
                sendOptions.seconds = options.duration || 0;
            }
            
            if (parsed.mediaType === 'audio') {
                sendOptions.ptt = options.ptt || false;
            }
            
            // Send the media
            await sock.sendMessage(to, {
                [parsed.mediaType]: buffer,
                ...sendOptions
            }, { quoted: options.quoted });
            
            return {
                success: true,
                type: parsed.mediaType,
                size: buffer.length,
                filename: sendOptions.filename
            };
            
        } catch (error) {
            if (logger) {
                logger.error({ error, url: url.substring(0, 100) }, 'Failed to send media');
            }
            throw error;
        }
    };

    /**
     * Test if URL is accessible
     */
    const testUrl = async (url) => {
        try {
            const parsed = parseWhatsAppUrl(url);
            
            const response = await axios.head(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Origin': 'https://web.whatsapp.com',
                    'Referer': 'https://web.whatsapp.com/'
                }
            });
            
            return {
                accessible: true,
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                parsed
            };
        } catch (error) {
            return {
                accessible: false,
                error: error.message,
                status: error.response?.status,
                parsed: parseWhatsAppUrl(url)
            };
        }
    };

    return {
        downloadFromUrl,
        downloadEncryptedWhatsAppMedia,
        downloadRegularWhatsAppMedia,
        sendMediaFromUrl,
        parseWhatsAppUrl,
        testUrl
    };
};

// =============== COMMAND HANDLERS ===============

cmd({
    pattern: "sendmedia",
    desc: "Send media from any URL (supports encrypted WhatsApp links)",
    category: "media",
    usage: "/sendmedia <url> [caption] [--key=base64_media_key]",
    filename: __filename
},
async(conn, mek, m, {from, reply, quoted, body, pushname}) => {
    try {
        const logger = conn.logger || console;
        const mediaFromLink = createMediaFromLink(conn, logger);
        
        // Parse input
        let input = body?.trim() || '';
        let url = '';
        let caption = '';
        let mediaKey = '';
        
        // Extract media key if provided
        const keyRegex = /--key=([a-zA-Z0-9+/=]+)/;
        const keyMatch = input.match(keyRegex);
        
        if (keyMatch) {
            mediaKey = keyMatch[1];
            input = input.replace(keyMatch[0], '').trim();
        }
        
        // Extract URL
        const urlRegex = /(https?:\/\/[^\s]+)/;
        const urlMatch = input.match(urlRegex);
        
        if (urlMatch) {
            url = urlMatch[1];
            caption = input.replace(url, '').trim();
        }
        
        // Check quoted message
        if (!url && quoted) {
            if (quoted.text) {
                const quotedUrlMatch = quoted.text.match(urlRegex);
                if (quotedUrlMatch) {
                    url = quotedUrlMatch[1];
                    caption = caption || quoted.text.replace(url, '').trim() || '';
                }
            }
        }
        
        // Validate URL
        if (!url) {
            const helpMsg = `📋 *Media Sender*\n\n` +
                          `*Usage:*\n\`/sendmedia <url> [caption] [--key=base64_key]\`\n\n` +
                          `*Examples:*\n` +
                          `• Regular URL: /sendmedia https://example.com/image.jpg Nice pic\n` +
                          `• WhatsApp URL: /sendmedia https://mmg.whatsapp.net/...\n` +
                          `• Encrypted (needs key): /sendmedia https://...file.enc --key=BASE64KEY\n\n` +
                          `*Your URL appears to be:*\n` +
                          `https://mmg.whatsapp.net/v/t62.7161-24/534526674_645658648608654_3696575190134551904_n.enc?...\n\n` +
                          `🔒 *This is ENCRYPTED media*\n` +
                          `You need the media key to decrypt it.`;
            
            return reply(helpMsg);
        }
        
        // Parse URL info
        const parsedUrl = mediaFromLink.parseWhatsAppUrl(url);
        
        // Send initial message
        const processingMsg = await reply(`📥 *Processing Media*\n\n` +
                                         `🔗 URL: ${url.substring(0, 60)}${url.length > 60 ? '...' : ''}\n` +
                                         `📊 Type: ${parsedUrl.mediaType.toUpperCase()}\n` +
                                         `🔒 Encrypted: ${parsedUrl.isEncrypted ? '✅ Yes' : '❌ No'}\n` +
                                         `🔑 Media Key: ${mediaKey ? '✅ Provided' : '❌ Missing'}\n` +
                                         `⏳ Downloading...`);
        
        try {
            // Send media
            const result = await mediaFromLink.sendMediaFromUrl(from, url, {
                caption: caption || `📤 Media sent by ${pushname}`,
                mediaKey: mediaKey,
                mediaType: parsedUrl.mediaType,
                quoted: mek,
                timeout: 120000 // 2 minutes for WhatsApp URLs
            });
            
            // Success message
            await reply(`✅ *Media Sent Successfully!*\n\n` +
                       `📊 Type: ${result.type.toUpperCase()}\n` +
                       `📁 File: ${result.filename}\n` +
                       `💾 Size: ${formatBytes(result.size)}\n` +
                       `🔒 Status: ${parsedUrl.isEncrypted ? 'Decrypted' : 'Normal'}\n` +
                       (caption ? `📝 Caption: ${caption}\n` : '') +
                       `👤 By: ${pushname}`);
            
        } catch (error) {
            console.error('Send media error:', error);
            
            let errorMsg = `❌ *Failed to Send Media*\n\n`;
            errorMsg += `*Error:* ${error.message}\n\n`;
            
            if (parsedUrl.isEncrypted && !mediaKey) {
                errorMsg += `🔐 *ENCRYPTED MEDIA DETECTED*\n`;
                errorMsg += `This media requires a media key for decryption.\n\n`;
                errorMsg += `*How to use:*\n`;
                errorMsg += `\`/sendmedia ${url} --key=BASE64_MEDIA_KEY\`\n\n`;
                errorMsg += `*Where to get media key:*\n`;
                errorMsg += `1. From original WhatsApp message\n`;
                errorMsg += `2. Use /getmedia on the original message\n`;
                errorMsg += `3. Look for "mediaKey" in message info`;
            } else if (error.statusCode === 403 || error.statusCode === 404) {
                errorMsg += `🚫 *Access Denied or Expired*\n`;
                errorMsg += `• URL might be expired\n`;
                errorMsg += `• Server blocked the request\n`;
                errorMsg += `• Requires authentication`;
            } else if (error.message.includes('timeout')) {
                errorMsg += `⏱️ *Timeout Error*\n`;
                errorMsg += `• Server is slow\n`;
                errorMsg += `• File is too large\n`;
                errorMsg += `• Network issues`;
            } else if (error.message.includes('decryption')) {
                errorMsg += `🔐 *Decryption Failed*\n`;
                errorMsg += `• Invalid media key\n`;
                errorMsg += `• Corrupted data\n`;
                errorMsg += `• Wrong media type`;
            }
            
            await reply(errorMsg);
        }
        
    } catch (error) {
        console.error("Command error:", error);
        await reply(`❌ Error: ${error.message}`);
    }
});

cmd({
    pattern: "urltest",
    desc: "Test if a URL is accessible",
    category: "media",
    filename: __filename
},
async(conn, mek, m, {from, reply, quoted, body}) => {
    try {
        const logger = conn.logger || console;
        const mediaFromLink = createMediaFromLink(conn, logger);
        
        let url = body?.trim() || '';
        
        if (!url && quoted) {
            if (quoted.text) {
                const urlMatch = quoted.text.match(/https?:\/\/[^\s]+/);
                if (urlMatch) url = urlMatch[0];
            }
        }
        
        if (!url) {
            return reply("❌ Please provide or quote a URL to test.");
        }
        
        await reply(`🧪 *Testing URL...*\n\`${url.substring(0, 50)}${url.length > 50 ? '...' : ''}\``);
        
        const startTime = Date.now();
        const result = await mediaFromLink.testUrl(url);
        const testTime = Date.now() - startTime;
        
        if (result.accessible) {
            let report = `✅ *URL Test PASSED*\n\n`;
            report += `🔗 URL: ${url.substring(0, 50)}${url.length > 50 ? '...' : ''}\n`;
            report += `📊 Status: ${result.status} ${result.statusText}\n`;
            report += `⏱️ Time: ${testTime}ms\n`;
            report += `📦 Type: ${result.parsed.mediaType.toUpperCase()}\n`;
            report += `🔒 Encrypted: ${result.parsed.isEncrypted ? 'Yes' : 'No'}\n`;
            
            if (result.headers['content-length']) {
                const size = parseInt(result.headers['content-length']);
                report += `💾 Size: ${formatBytes(size)}\n`;
            }
            
            if (result.headers['content-type']) {
                report += `📄 Content-Type: ${result.headers['content-type']}\n`;
            }
            
            report += `\n✅ *Ready to download*\n`;
            
            if (result.parsed.isEncrypted) {
                report += `\n🔐 *Note:* This is encrypted media\n`;
                report += `You'll need a media key to decrypt it.`;
            }
            
            await reply(report);
        } else {
            let report = `❌ *URL Test FAILED*\n\n`;
            report += `🔗 URL: ${url.substring(0, 50)}${url.length > 50 ? '...' : ''}\n`;
            report += `⏱️ Time: ${testTime}ms\n`;
            report += `📊 Status: ${result.status || 'No response'}\n`;
            report += `❗ Error: ${result.error}\n`;
            report += `🔒 Encrypted: ${result.parsed.isEncrypted ? 'Yes' : 'No'}\n\n`;
            
            report += `*Possible Issues:*\n`;
            if (result.status === 403) {
                report += `• Access forbidden\n`;
                report += `• Requires authentication\n`;
                report += `• Server blocked request\n`;
            } else if (result.status === 404) {
                report += `• File not found\n`;
                report += `• URL expired\n`;
                report += `• Invalid path\n`;
            } else if (result.status === 410) {
                report += `• Content gone\n`;
                report += `• Permanently removed\n`;
            } else {
                report += `• Server down\n`;
                report += `• Network issue\n`;
                report += `• Invalid URL\n`;
            }
            
            if (result.parsed.isEncrypted) {
                report += `\n🔐 *Encrypted media detected*\n`;
                report += `Even if accessible, it requires a media key.`;
            }
            
            await reply(report);
        }
        
    } catch (error) {
        console.error("Test error:", error);
        await reply(`❌ Test failed: ${error.message}`);
    }
});

cmd({
    pattern: "urlinfo",
    desc: "Get detailed information about a URL",
    category: "media",
    filename: __filename
},
async(conn, mek, m, {from, reply, quoted, body}) => {
    try {
        const logger = conn.logger || console;
        const mediaFromLink = createMediaFromLink(conn, logger);
        
        let url = body?.trim() || '';
        
        if (!url && quoted) {
            if (quoted.text) {
                const urlMatch = quoted.text.match(/https?:\/\/[^\s]+/);
                if (urlMatch) url = urlMatch[0];
            }
        }
        
        if (!url) {
            // Show example with user's URL
            const exampleUrl = 'https://mmg.whatsapp.net/v/t62.7161-24/534526674_645658648608654_3696575190134551904_n.enc?ccb=11-4&oh=01_Q5Aa3gGYof1ZoMzLVx9Wj2lyrENhjopEGFy4g_PIaKxrwrwltw&oe=699888CB&_nc_sid=5e03e0&mms3=true';
            
            return reply(`📋 *URL Information Tool*\n\n` +
                        `*Usage:*\n\`/urlinfo <url>\`\n\n` +
                        `*Example with your URL:*\n` +
                        `\`/urlinfo ${exampleUrl}\`\n\n` +
                        `This will analyze the WhatsApp direct link.`);
        }
        
        await reply(`🔍 *Analyzing URL...*`);
        
        const parsed = mediaFromLink.parseWhatsAppUrl(url);
        
        let info = `🔍 *URL Analysis Report*\n\n`;
        info += `🔗 *Full URL:*\n\`\`\`${url.length > 80 ? url.substring(0, 80) + '...' : url}\`\`\`\n\n`;
        info += `📊 *Basic Information:*\n`;
        info += `• Hostname: ${parsed.hostname || 'mmg.whatsapp.net'}\n`;
        info += `• Path: ${parsed.pathname?.substring(0, 50) || 'Unknown'}${parsed.pathname?.length > 50 ? '...' : ''}\n`;
        info += `• Filename: ${parsed.filename || 'Unknown'}\n`;
        info += `• Media Type: ${parsed.mediaType.toUpperCase()}\n`;
        info += `• MIME Type: ${parsed.mimetype}\n`;
        info += `• Extension: .${parsed.extension}\n`;
        info += `• Encrypted: ${parsed.isEncrypted ? '✅ YES (.enc file)' : '❌ No'}\n`;
        info += `• Suggested Name: ${parsed.suggestedFilename}\n`;
        
        info += `\n🔐 *Encryption Status:*\n`;
        if (parsed.isEncrypted) {
            info += `⚠️ *REQUIRES MEDIA KEY*\n`;
            info += `This is encrypted WhatsApp media.\n`;
            info += `You need the media key to decrypt it.\n\n`;
            info += `*Command format:*\n`;
            info += `\`/sendmedia ${url.split('?')[0].substring(0, 30)}... --key=BASE64_KEY\`\n`;
        } else {
            info += `✅ Can be downloaded directly\n`;
            info += `Use: \`/sendmedia ${url.split('?')[0].substring(0, 30)}...\``;
        }
        
        info += `\n📋 *URL Parameters:*\n`;
        if (parsed.params && Object.keys(parsed.params).length > 0) {
            for (const [key, value] of Object.entries(parsed.params)) {
                info += `• ${key}: ${value.substring(0, 20)}${value.length > 20 ? '...' : ''}\n`;
            }
        } else {
            info += `• No parameters\n`;
        }
        
        info += `\n📥 *Available Commands:*\n`;
        info += `• \`/sendmedia ${url.split('?')[0].substring(0, 30)}...\`\n`;
        if (parsed.isEncrypted) {
            info += `• \`/sendmedia ${url.split('?')[0].substring(0, 30)}... --key=KEY\` (encrypted)\n`;
        }
        info += `• \`/urltest ${url.split('?')[0].substring(0, 30)}...\` (test)\n`;
        
        await reply(info);
        
    } catch (error) {
        console.error("Info error:", error);
        await reply(`❌ Analysis failed: ${error.message}`);
    }
});

// Helper function
function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Export
module.exports = {
    createMediaFromLink,
    formatBytes
};

//=============================================
cmd({
    pattern: "videoq",
    desc: "Ai chat.",
    category: "other",
    filename: __filename
},
async(conn, mek, m, {from, mnu, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply}) => {

try{
const config = await readEnv(botNumber2);
const cbotname = `${config.BOT_NAME}`
const cbotlogo = `${config.BOT_LOGO}`
const cown = `${config.OWNER_NAME}`
const cownnum = `94742274855`
  return await conn.sendMessage(from,{video:{url: q },mimetype:"video/mp4",caption :`> ⚖️𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 - : ${cown}`},{quoted:mek})
                        
}catch(e){
console.log(e)
reply(`${e}`)
}
})

cmd({
    pattern: "mrtn",
    desc: "Ai chat.",
    category: "other",
    filename: __filename
},
async(conn, mek, m, {from, mnu, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply}) => {

try{
  return await reply(q)                 
}catch(e){
console.log(e)
reply(`${e}`)
}
})

cmd({
    pattern: "vdocumentq",
    dontAddCommandList: true,
    filename: __filename
},
async(conn, mek, m, {from, mnu, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply}) => {
    try {
    const config = await readEnv(botNumber2);
const cbotname = `${config.BOT_NAME}`
const cbotlogo = `${config.BOT_LOGO}`
const cown = `${config.OWNER_NAME}`
const cownnum = `94742274855`
        if (!q) {
            return await conn.sendMessage(from, { text: '*A download link is required.*' }, { quoted: mek });
        }

        await conn.sendMessage(from, { react: { text: '📥', key: mek.key } });

        let sendapk = await conn.sendMessage(from, {
            document: { url: q },
            mimetype: 'video/mp4',
            fileName: `${cown}`
        }, { quoted: mek });

        await conn.sendMessage(from, { react: { text: '📁', key: sendapk.key } });
        await conn.sendMessage(from, { react: { text: '✔', key: mek.key } });
    } catch (e) {
        reply(`${e}`);
        console.log(e);
    }
});

cmd({
    pattern: "docsongq",
    desc: "Ai chat.",
    react: "🗂",
    category: "other",
    filename: __filename
},
async(conn, mek, m, {from, mnu, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply}) => {

try{
const config = await readEnv(botNumber2);
const cbotname = `${config.BOT_NAME}`
const cbotlogo = `${config.BOT_LOGO}`
const cown = `${config.OWNER_NAME}`
const cownnum = `94742274855`
                        // Send Document
                        await conn.sendMessage(from, { 
                            document: { url: q },
                            mimetype: "audio/mpeg", 
                            fileName: `${cown}.mp3`, 
                            caption: `> *⚖️𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 - : ${cown}*` 
                        }, { quoted: mek });
}catch(e){
console.log(e)
reply(`${e}`)
}
})

cmd({
    pattern: "res",
    alias: ["response"],
    desc: 'Download Song / Video',
    use: '.play Title',
    react: "🎧",
    category: 'download',
    filename: __filename
},
async (conn, mek, m, { from, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply }) => {
    try {
    const config = await readEnv(botNumber2);
const cbotname = `${config.BOT_NAME}`
const cbotlogo = `${config.BOT_LOGO}`
const cown = `${config.OWNER_NAME}`
const cownnum = `94742274855`
        if (!q) return reply('Please provide a title.');
        
        await conn.sendMessage(from, {audio: {url: q },mimetype:"audio/mpeg", caption :`> *⚖️𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 - : ${cown}*`}, { quoted:mek } )

} catch (e) {
reply(`${e}`)
console.log(e)
}
})

cmd({
    pattern: "resd",
    desc: "Ai chat.",
    react: "🗂",
    category: "other",
    filename: __filename
},
async(conn, mek, m, {from, mnu, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply}) => {

try{
const config = await readEnv(botNumber2);
const cbotname = `${config.BOT_NAME}`
const cbotlogo = `${config.BOT_LOGO}`
const cown = `${config.OWNER_NAME}`
const cownnum = `94742274855`
        if (!q) return reply('*Please provide a title or YouTube link.*');
        /*
        const asdt = await fetchJson(`https://manu-md-yako-thopita-hoyaganna-ba-m.vercel.app/my-raw-xzrow-only-raw-plus`);
        const AS = asdt.API_SITE_PRO;
        const AS_KEY = asdt.API_SITE_PRO_KEY;
        const dataa = await fetchJson(`${AS}/api/youtube-mp3?url=${encodeURIComponent(q)}&quality=96&apikey=${AS_KEY}`);
        const mres = dataa.download;
        const dl_link = mres.url;
      const fn = mres.title;
      */
        const dataa = await fetchJson(`https://my-private-api-site.vercel.app/convert?mp3=${q}&apikey=Manul-Official`);
        const mres = dataa.data;
        const dl_link = mres.url
        const fn = mres.filename;
                        // Send Document
                        await conn.sendMessage(from, { 
                            document: { url: dl_link },
                            mimetype: "audio/mpeg", 
                            fileName: `${fn}`, 
                            caption: `
*File Name -:* *${fn}*

> *⚖️𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 - : ${cown}*
`
                        }, { quoted: mek });
}catch(e){
console.log(e)
reply(`${e}`)
}
})

cmd({
    pattern: "resp",
    desc: "Ai chat.",
    react: "🎙",
    category: "other",
    filename: __filename
},
async(conn, mek, m, {from, mnu, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply}) => {

try{
const config = await readEnv(botNumber2);
const cbotname = `${config.BOT_NAME}`
const cbotlogo = `${config.BOT_LOGO}`
const cown = `${config.OWNER_NAME}`
const cownnum = `94742274855`
await conn.sendMessage(from, { audio: { url: q }, mimetype: 'audio/mp4', ptt: true }, { quoted:mek })

}catch(e){
console.log(e)
reply(`${e}`)
}
})


const fs = require('fs-extra');
const path = require('path');
const { MongoClient } = require('mongodb');

// Configuration
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://manulofcusa_db_user:nCm9YgcgCK5dFrMr@cluster0.zslhhlg.mongodb.net/';
const DATABASE_NAME = 'MANUDB';
const COLLECTION_NAME = 'SETTINGS';

// Connection state - SINGLETON PATTERN
let mongoClient = null;
let mongoConnectionPromise = null;
let isMongoConnected = false;
let isConnecting = false;
let syncQueue = new Map();
let syncTimer = null;
let connectionCheckInterval = null;
let lastActivityTime = Date.now();

// Default settings (same as your defaults)
const defaults = {
  BOT_NAME: "𝑴𝑨𝑵𝑼-𝑴𝑫-𝑳𝑰𝑻𝑬",
  OWNER_NUMBER: "94742274855",
  OWNER_NAME: "© 𝑀𝑅 𝑀𝐴𝑁𝑈𝐿 𝑂𝐹𝐶 💚",
  OWNER_FROM: "Sri Lanka",
  BUTTON: "false",
  OWNER_AGE: "+99",
  PRIFIX: ".",
  MODE: "private",
  MANU_LAN: "EN",
  LANGUAGE: "",
  MOVIE_JIDS: "",
  AUTO_REACT: "false",
  ANTI_DELETE: "false",
  ANTI_SEND: "me",
  ANTI_CALL: "false",
  CALL_REJECT_LIST: "",
  CALL_OPEN_LIST: "",
  AUTO_REACT_STATUS: "false",
  AUTO_TYPING: "false",
  AUTO_RECODING: "false",
  ALWAYS_ONLINE: "false",
  AUTO_READ_STATUS: "false",
  AUTO_READ_MSG: "false",
  AUTO_SAVE: "false",
  CMD_READ: "false",
  AUTO_VOICE: "false",
  AUTO_BLOCK: "false",
  BOT_LOGO: "https://my-private-api-site.vercel.app/manu-md-lite",
  OWNER_IMG: "https://my-private-api-site.vercel.app/manu-md-lite",
  MENU_LOGO: "https://my-private-api-site.vercel.app/manu-md-lite",
  ALIVE_LOGO: "https://my-private-api-site.vercel.app/manu-md-lite",
  ALIVE_MSG: "⚖️𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 - : © 𝑀𝑅 𝑀𝐴𝑁𝑈𝐿 𝑂𝐹𝐶 💚",
  AUTO_DP_CHANGE: "false",
  AUTO_DP: "",
  BAN: "",
  SUDO: "",
  AUTO_CHANNEL_SONG: "false",
  XNX_VIDEO: "false",
  CHANNEL_JID: "",
  _source: 'json'
};

// Enhanced SettingsCache with activity tracking
class SettingsCache {
  constructor(maxSize = 1000, ttl = 30 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cache = new Map();
    this.timestamps = new Map();
  }

  set(key, value) {
    // LRU eviction if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = Array.from(this.timestamps.entries())
        .sort((a, b) => a[1] - b[1])[0]?.[0];
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.timestamps.delete(oldestKey);
      }
    }
    
    this.cache.set(key, value);
    this.timestamps.set(key, Date.now());
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    
    const timestamp = this.timestamps.get(key);
    if (Date.now() - timestamp > this.ttl) {
      this.cache.delete(key);
      this.timestamps.delete(key);
      return null;
    }
    
    // Update timestamp for LRU
    this.timestamps.set(key, Date.now());
    return this.cache.get(key);
  }

  delete(key) {
    this.cache.delete(key);
    this.timestamps.delete(key);
  }

  clear() {
    this.cache.clear();
    this.timestamps.clear();
  }

  get size() {
    return this.cache.size;
  }
}

const settingsCache = new SettingsCache();

// Helper functions
function cleanOwnerNumber(ownerNumber) {
  if (!ownerNumber) return '';
  return String(ownerNumber)
    .replace('creds.json', '')
    .replace(/[^0-9]/g, '')
    .trim();
}

async function ensureSettingsDir() {
  const settingsDir = path.join(__dirname, 'settings');
  try {
    await fs.ensureDir(settingsDir);
  } catch (error) {
    console.error('❌ Error creating settings directory:', error.message);
  }
}

// Connection Management Functions
async function initializeMongoDB() {
  // If already connecting, return the existing promise
  if (isConnecting && mongoConnectionPromise) {
    return mongoConnectionPromise;
  }
  
  // If already connected, return client
  if (isMongoConnected && mongoClient) {
    return mongoClient;
  }
  
  isConnecting = true;
  
  mongoConnectionPromise = (async () => {
    try {
     // console.log('🔄 Establishing persistent MongoDB connection...');
      
      mongoClient = new MongoClient(MONGO_URI, {
        maxPoolSize: 100, // Increased for better connection reuse
        minPoolSize: 10,  // Keep more connections open
        maxIdleTimeMS: 60000, // 1 minute idle time
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        retryWrites: true,
        retryReads: true,
        ssl: true,
        tls: true,
        // Connection pooling optimizations
        waitQueueTimeoutMS: 10000,
        maxConnecting: 5,
        monitorCommands: false,
        forceServerObjectId: false,
        readPreference: 'primary',
        writeConcern: { w: 'majority' }
      });
      
      // Connect only once
      await mongoClient.connect();
      
      // Test connection
      await mongoClient.db(DATABASE_NAME).command({ ping: 1 });
      
      isMongoConnected = true;
      isConnecting = false;
      lastActivityTime = Date.now();
      
     // console.log('✅ MongoDB connected successfully (persistent connection)');
      
      // Start batch sync timer
      if (!syncTimer) {
        syncTimer = setInterval(async () => {
          if (syncQueue.size > 0) {
            await syncBatchToMongoDB();
          }
          // Update last activity time
          lastActivityTime = Date.now();
        }, 30000); // Reduced to 30 seconds for faster sync
      }
      
      // Start connection health check
      if (!connectionCheckInterval) {
        connectionCheckInterval = setInterval(async () => {
          await checkConnectionHealth();
        }, 60000); // Check every minute
      }
      
      return mongoClient;
      
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      isMongoConnected = false;
      isConnecting = false;
      mongoClient = null;
      mongoConnectionPromise = null;
      
      // Retry connection after delay
      setTimeout(() => {
        if (!isMongoConnected) {
          console.log('🔄 Retrying MongoDB connection...');
          initializeMongoDB();
        }
      }, 10000);
      
      return null;
    }
  })();
  
  return mongoConnectionPromise;
}

// Get MongoDB client with guaranteed connection
async function getMongoClient() {
  // Update activity time
  lastActivityTime = Date.now();
  
  if (isMongoConnected && mongoClient) {
    return mongoClient;
  }
  
  // Try to get existing connection promise
  if (mongoConnectionPromise) {
    return await mongoConnectionPromise;
  }
  
  // Initialize new connection
  return await initializeMongoDB();
}

// Check connection health
async function checkConnectionHealth() {
  if (!mongoClient || !isMongoConnected) return;
  
  try {
    await mongoClient.db(DATABASE_NAME).command({ ping: 1 });
    //console.log('✅ MongoDB connection is healthy');
    lastActivityTime = Date.now();
  } catch (error) {
    console.error('❌ MongoDB connection health check failed:', error.message);
    isMongoConnected = false;
    
    // Attempt to reconnect
    setTimeout(() => {
      if (!isMongoConnected) {
      //  console.log('🔄 Reconnecting after health check failure...');
        initializeMongoDB();
      }
    }, 5000);
  }
}

// Check if document exists in MongoDB
async function checkMongoDBExists(ownerNumber) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber) return null;
  
  try {
    const client = await getMongoClient();
    if (!client) return null;
    
    const db = client.db(DATABASE_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const existingDoc = await collection.findOne({ ownerNumber: cleanNumber });
    return existingDoc;
  } catch (error) {
    // Silently handle connection errors
    return null;
  }
}

// Load from MongoDB and save to JSON
async function loadFromMongoDB(ownerNumber) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber) return null;
  
  try {
    const existingDoc = await checkMongoDBExists(cleanNumber);
    if (!existingDoc) return null;
    
    const settings = {
      ownerNumber: cleanNumber,
      ...defaults,
      ...existingDoc,
      _source: 'mongo',
      _lastLoaded: Date.now(),
      _isTemp: false // This came from MongoDB, so it's not temp
    };
    
    delete settings._id;
    
    // Save to JSON file
    await saveToJSON(cleanNumber, settings);
    
    return settings;
  } catch (error) {
    console.error(`❌ Error loading from MongoDB for ${cleanNumber}:`, error.message);
    return null;
  }
}

// JSON file operations (same as before)
async function loadFromJSON(ownerNumber) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber) return null;
  
  try {
    await ensureSettingsDir();
    const filePath = path.join(__dirname, 'settings', `${cleanNumber}.json`);
    
    if (await fs.pathExists(filePath)) {
      const settings = await fs.readJson(filePath);
      return {
        ...settings,
        _source: 'json',
        _lastLoaded: Date.now(),
        ownerNumber: cleanNumber
      };
    }
  } catch (error) {
    console.error(`❌ Error loading JSON for ${cleanNumber}:`, error.message);
  }
  
  return null;
}

async function saveToJSON(ownerNumber, settings) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber || !settings) return false;
  
  try {
    await ensureSettingsDir();
    const filePath = path.join(__dirname, 'settings', `${cleanNumber}.json`);
    
    const { _source, _lastLoaded, _lastUpdated, _isTemp, ...cleanSettings } = settings;
    
    await fs.writeJson(filePath, cleanSettings, { spaces: 2 });
    return true;
  } catch (error) {
    console.error(`❌ Error saving JSON for ${cleanNumber}:`, error.message);
    return false;
  }
}

// Load or create settings
async function loadSettings(ownerNumber) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber) {
    return { ...defaults, ownerNumber: '', _source: 'default', _isTemp: true };
  }
  
  // 1. Check cache first
  const cached = settingsCache.get(cleanNumber);
  if (cached) {
    return cached;
  }
  
  // 2. Try JSON file
  const jsonSettings = await loadFromJSON(cleanNumber);
  if (jsonSettings) {
    settingsCache.set(cleanNumber, jsonSettings);
    return jsonSettings;
  }
  
  // 3. Try MongoDB
  const mongoSettings = await loadFromMongoDB(cleanNumber);
  if (mongoSettings) {
    settingsCache.set(cleanNumber, mongoSettings);
    return mongoSettings;
  }
  
  // 4. Create TEMPORARY defaults
  const settings = {
    ownerNumber: cleanNumber,
    ...defaults,
    _source: 'temp',
    _isTemp: true,
    _createdAt: Date.now()
  };
  
  await saveToJSON(cleanNumber, settings);
  settingsCache.set(cleanNumber, settings);
  
  return settings;
}

// Alias for loadSettings
async function readEnv(ownerNumber) {
  return await loadSettings(ownerNumber);
}

// Initialize/ensure settings exist
async function defEnv(ownerNumber) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber) return false;
  
  try {
    const settings = await loadSettings(cleanNumber);
    return !settings._isTemp;
  } catch (error) {
    console.error(`❌ Error in defEnv for ${cleanNumber}:`, error.message);
    return false;
  }
}

// FIXED: Batch sync to MongoDB
async function syncBatchToMongoDB() {
  if (!isMongoConnected || syncQueue.size === 0) return;
  
  try {
    const client = await getMongoClient();
    if (!client) return;
    
    const db = client.db(DATABASE_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const operations = [];
    const now = Date.now();
    const queueEntries = Array.from(syncQueue.entries());
    
    for (const [ownerNumber, settings] of queueEntries) {
      if (settings._isTemp) {
        syncQueue.delete(ownerNumber);
        continue;
      }
      
      const { _source, _lastLoaded, _lastUpdated, _isTemp, ...cleanSettings } = settings;
      
      // First check if document exists
      const existingDoc = await collection.findOne({ ownerNumber });
      
      if (existingDoc) {
        // Document exists, update without $setOnInsert
        operations.push({
          updateOne: {
            filter: { ownerNumber },
            update: {
              $set: {
                ...cleanSettings,
                _updatedAt: now
              }
            }
          }
        });
      } else {
        // Document doesn't exist, create with _createdAt
        operations.push({
          updateOne: {
            filter: { ownerNumber },
            update: {
              $set: {
                ...cleanSettings,
                _createdAt: now,
                _updatedAt: now
              }
            },
            upsert: true
          }
        });
      }
      
      syncQueue.delete(ownerNumber);
    }
    
    if (operations.length > 0) {
      const result = await collection.bulkWrite(operations, { ordered: false });
    //  console.log(`✅ Batch synced ${operations.length} settings to MongoDB (Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}, Upserted: ${result.upsertedCount})`);
    }
  } catch (error) {
    console.error('❌ Batch sync failed:', error.message);
  }
}

// FIXED: Update settings
async function updateEnv(ownerNumber, key, newValue) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber || !key) {
    console.error('❌ Invalid parameters for update');
    return false;
  }
  
  try {
    const currentSettings = await loadSettings(cleanNumber);
    const wasTemp = currentSettings._isTemp;
    
    let updatedValue = newValue;
    if (key === "AUTO_DP") {
      let currentValues = [];
      if (typeof currentSettings[key] === "string" && currentSettings[key].trim() !== "") {
        currentValues = currentSettings[key].split(",").map(v => v.trim()).filter(v => v !== "");
      }
      
      currentValues.push(newValue);
      
      if (currentValues.length > 5) {
        currentValues.shift();
      }
      
      updatedValue = currentValues.join(",");
    }
    
    const updatedSettings = {
      ...currentSettings,
      [key]: updatedValue,
      _lastUpdated: Date.now(),
      _isTemp: false
    };
    
    settingsCache.set(cleanNumber, updatedSettings);
    await saveToJSON(cleanNumber, updatedSettings);
    
    // Queue for MongoDB sync if connected
    if (isMongoConnected) {
      syncQueue.set(cleanNumber, updatedSettings);
      
      // If this was a temp setting being saved for first time, sync immediately
      if (wasTemp) {
        setTimeout(async () => {
          if (syncQueue.has(cleanNumber)) {
            try {
              const client = await getMongoClient();
              if (client) {
                const db = client.db(DATABASE_NAME);
                const collection = db.collection(COLLECTION_NAME);
                
                const { _source, _lastLoaded, _lastUpdated, _isTemp, ...cleanSettings } = updatedSettings;
                
                // Check if document exists first
                const existingDoc = await collection.findOne({ ownerNumber: cleanNumber });
                const now = Date.now();
                
                if (existingDoc) {
                  // Update existing document
                  await collection.updateOne(
                    { ownerNumber: cleanNumber },
                    { 
                      $set: {
                        ...cleanSettings,
                        _updatedAt: now
                      }
                    }
                  );
                } else {
                  // Create new document
                  await collection.updateOne(
                    { ownerNumber: cleanNumber },
                    { 
                      $set: {
                        ...cleanSettings,
                        _createdAt: now,
                        _updatedAt: now
                      }
                    },
                    { upsert: true }
                  );
                }
                
                syncQueue.delete(cleanNumber);
            //    console.log(`✅ First-time sync successful for ${cleanNumber}`);
              }
            } catch (error) {
              console.error(`❌ First-time sync failed for ${cleanNumber}:`, error.message);
            }
          }
        }, 1000);
      }
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Error updating ${key} for ${cleanNumber}:`, error.message);
    return false;
  }
}

// Update list (comma-separated values)
async function updateList(ownerNumber, key, values, action = "add") {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber || !key) return false;
  
  try {
    const currentSettings = await loadSettings(cleanNumber);
    
    let valuesArray = [];
    if (Array.isArray(values)) {
      valuesArray = values;
    } else if (typeof values === 'string') {
      valuesArray = values.split(',').map(v => v.trim()).filter(v => v !== '');
    } else {
      return false;
    }
    
    const currentValue = currentSettings[key] || "";
    let currentArray = currentValue.split(',').map(v => v.trim()).filter(v => v !== '');
    
    if (action === "add") {
      const combinedSet = new Set([...currentArray, ...valuesArray]);
      currentArray = Array.from(combinedSet);
    } else if (action === "remove") {
      currentArray = currentArray.filter(v => !valuesArray.includes(v));
    } else {
      return false;
    }
    
    const newValue = currentArray.join(',');
    return await updateEnv(cleanNumber, key, newValue);
    
  } catch (error) {
    console.error(`❌ Error updating list ${key} for ${cleanNumber}:`, error.message);
    return false;
  }
}

// FIXED: Force sync to MongoDB
async function forceSyncToMongoDB(ownerNumber) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber) return false;
  
  try {
    const settings = await loadSettings(cleanNumber);
    
    if (settings._isTemp) {
      return false;
    }
    
    const client = await getMongoClient();
    if (!client) return false;
    
    const db = client.db(DATABASE_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const { _source, _lastLoaded, _lastUpdated, _isTemp, ...cleanSettings } = settings;
    
    // Check if document exists first
    const existingDoc = await collection.findOne({ ownerNumber: cleanNumber });
    const now = Date.now();
    
    if (existingDoc) {
      // Update existing document
      await collection.updateOne(
        { ownerNumber: cleanNumber },
        { 
          $set: {
            ...cleanSettings,
            _updatedAt: now
          }
        }
      );
    } else {
      // Create new document
      await collection.updateOne(
        { ownerNumber: cleanNumber },
        { 
          $set: {
            ...cleanSettings,
            _createdAt: now,
            _updatedAt: now
          }
        },
        { upsert: true }
      );
    }
    
    syncQueue.delete(cleanNumber);
   // console.log(`✅ Force sync successful for ${cleanNumber}`);
    
    return true;
  } catch (error) {
    console.error(`❌ Force sync failed for ${cleanNumber}:`, error.message);
    return false;
  }
}

// Clean up MongoDB documents - remove any conflicting _createdAt fields
async function cleanupMongoDBDocuments() {
  try {
    const client = await getMongoClient();
    if (!client) return false;
    
    const db = client.db(DATABASE_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    // Find all documents
    const allDocs = await collection.find({}).toArray();
    
    for (const doc of allDocs) {
      // Remove any duplicate _createdAt fields that might be in the wrong format
      await collection.updateOne(
        { _id: doc._id },
        { 
          $unset: {
            '_createdAt': ""
          },
          $set: {
            '_updatedAt': Date.now()
          }
        }
      );
      
      // Re-add the _createdAt field with proper format if it doesn't exist
      if (!doc._createdAt) {
        await collection.updateOne(
          { _id: doc._id },
          { 
            $set: {
              '_createdAt': Date.now()
            }
          }
        );
      }
    }
    
   // console.log(`✅ Cleaned up ${allDocs.length} MongoDB documents`);
    return true;
  } catch (error) {
    console.error('❌ MongoDB cleanup failed:', error.message);
    return false;
  }
}

// Close connections gracefully
async function closeConnection() {
  console.log('🔄 Closing MongoDB connections gracefully...');
  
  // Sync any remaining items
  if (syncQueue.size > 0 && isMongoConnected) {
    console.log(`Syncing ${syncQueue.size} remaining items...`);
    await syncBatchToMongoDB();
  }
  
  // Clear timers
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
    connectionCheckInterval = null;
  }
  
  // Close MongoDB connection
  if (mongoClient && isMongoConnected) {
    try {
      // Give connections time to finish
      setTimeout(async () => {
        await mongoClient.close();
        console.log('✅ MongoDB connection closed gracefully');
      }, 1000);
    } catch (error) {
      console.error('❌ Error closing MongoDB:', error.message);
    } finally {
      mongoClient = null;
      isMongoConnected = false;
      mongoConnectionPromise = null;
    }
  }
  
  // Clear cache
  settingsCache.clear();
  syncQueue.clear();
}

// Initialize connection on module load (but don't block)
(async () => {
  await ensureSettingsDir();
  // Initialize MongoDB connection in background
  initializeMongoDB().catch(console.error);
  console.log('✅ Settings manager initialized with persistent MongoDB connection');
  
  // Run cleanup on startup to fix existing documents
  setTimeout(async () => {
    if (isMongoConnected) {
      await cleanupMongoDBDocuments();
    }
  }, 10000);
})();

// Handle process cleanup
process.on('SIGINT', async () => {
  await closeConnection();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeConnection();
  process.exit(0);
});

process.on('beforeExit', async () => {
  await closeConnection();
});

module.exports = {
  readEnv,
  defEnv,
  updateEnv,
  updateList,
  loadSettings,
  closeConnection,
  forceSyncToMongoDB,
  cleanupMongoDBDocuments,
  cleanOwnerNumber,
  loadFromJSON,
  saveToJSON,
  
  // Status getters
  get isMongoConnected() {
    return isMongoConnected;
  },
  
  get cacheSize() {
    return settingsCache.size;
  },
  
  get queueSize() {
    return syncQueue.size;
  },
  
  get lastActivity() {
    return lastActivityTime;
  }
};
