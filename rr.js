let botLids = {};
let allgroupsMeta = {};

const normalizeId2 = (rawId) => {
 
    if (!rawId) return { jid: "", lid: "", base: "" };
    let jid = rawId.includes('@s.whatsapp.net') ? rawId : rawId.includes('@lid') ? rawId : `${rawId}@s.whatsapp.net`;
    let lid = rawId.includes('@lid') ? rawId : "";
    let base = rawId.split('@')[0].split(':')[0];
    return { jid, lid, base };
};


const idEquals = (a = {}, b = {}) => {
    if (!a || !b) return false;
    if (a.jid && b.jid && a.jid === b.jid) return true;
    if (a.lid && b.lid && a.lid === b.lid) return true;
    if (a.base && b.base && a.base === b.base) return true;
    return false;
};


const getAdminFlag = (p) => {
    if (!p) return null;
    if (typeof p.admin === "string") return p.admin;
    if (p.role) return p.role;
    if (typeof p.isAdmin === "boolean" && p.isAdmin) return "admin";
    if (typeof p.isSuperAdmin === "boolean" && p.isSuperAdmin) return "superadmin";
    return null;
};


const matchByJidOrLid = (p, targetNorm) => {
    if (!p || !targetNorm) return false;
    const pidJid = p.id?.includes('@s.whatsapp.net') ? p.id : p.jid || p.id || "";
    const pidLid = p.id?.includes('@lid') ? p.id : p.lid || "";
    const pidBase = (pidJid || pidLid).split?.("@")?.[0] || "";

    if (targetNorm.jid && pidJid && pidJid === targetNorm.jid) return true;
    if (targetNorm.lid && pidLid && pidLid === targetNorm.lid) return true;
    if (targetNorm.base && pidBase && pidBase === targetNorm.base) return true;

    return false;
};



Sock.ev.on("messages.upsert", async ({ messages }) => {
    const mek = messages?.[0];
    if (!mek?.message) return;

   
    if (mek.message?.protocolMessage) return;


    const botNumber = sock.user?.id?.split?.(":")?.[0] || ""; 
    const from = mek.key.remoteJid || ""; 
    const isGroup = from.endsWith("@g.us");
    const isChannel = from.endsWith("@newsletter");
    const isStatus = from === "status@broadcast";
    

    let rawFrom = isGroup ? mek.key.participant || mek.participant || "" : from;
    const senderId = normalizeId2(rawFrom); 
    
  
    let botLid = botLids[botNumber] || "";
    if (!botLid && botNumber) {
        try {
            const botJid = `${botNumber}@s.whatsapp.net`;
            const onWa = await sock.onWhatsApp(botJid);
            botLid = onWa?.[0]?.lid || "";
            if (botLid) {
                botLids[botNumber] = botLid; 
            }
        } catch (e) {
            console.warn("Failed to get botLid via onWhatsApp():", e?.message || e);
        }
    }
    const botId = { jid: `${botNumber}@s.whatsapp.net`, lid: botLid || "", base: botNumber };

 
    let body = "";
    let quotedMessage = null;
    let contextInfo = 
        mek.message?.extendedTextMessage?.contextInfo ||
        mek.message?.imageMessage?.contextInfo ||
        mek.message?.videoMessage?.contextInfo ||
        mek.message?.audioMessage?.contextInfo ||
        mek.message?.documentMessage?.contextInfo ||
        mek.message?.stickerMessage?.contextInfo ||
        null;
    
    quotedMessage = contextInfo?.quotedMessage || null;


  
    const getMessageTypeAndObject = (msg) => {
        if (!msg) return { type: null, obj: null };
        const keys = Object.keys(msg);
        for (const key of keys) {
            if (key.endsWith('Message')) {
                
                if (key === 'conversation') continue; 
                return { type: key, obj: msg[key] };
            }
        }
        if (msg.conversation) return { type: 'conversation', obj: msg };
        return { type: null, obj: null };
    };
    
 
    const { type: bodyType, obj: bodyObj } = getMessageTypeAndObject(mek.message);

 
    const { type: quotedBodyType, obj: quotedBodyObj } = getMessageTypeAndObject(quotedMessage);



    if (bodyType === 'conversation') {
        body = mek.message.conversation;
    } else if (bodyType === 'extendedTextMessage') {
        body = bodyObj?.text || "";
    } else if (bodyObj?.caption) {
        body = bodyObj.caption;
    } else {
        body = ""; 
    }

    let quotedbody = "";
    if (quotedBodyType === 'conversation') {
        quotedbody = quotedMessage.conversation;
    } else if (quotedBodyType === 'extendedTextMessage') {
        quotedbody = quotedBodyObj?.text || "";
    } else if (quotedBodyObj?.caption) {
        quotedbody = quotedBodyObj.caption;
    } else {
        quotedbody = ""; 
    }


   
    const isBodyImage = bodyType === 'imageMessage';
    const isBodyVideo = bodyType === 'videoMessage';
    const isBodyAudio = bodyType === 'audioMessage';
    const isBodyDocument = bodyType === 'documentMessage';
    const isBodySticker = bodyType === 'stickerMessage';

    const isquotedBodyImage = quotedBodyType === 'imageMessage';
    const isquotedBodyVideo = quotedBodyType === 'videoMessage';
    const isquotedBodyAudio = quotedBodyType === 'audioMessage';
    const isquotedBodyDocument = quotedBodyType === 'documentMessage';
    const isquotedBodySticker = quotedBodyType === 'stickerMessage';

 
    let bodyimageBuffer = null;
    let quotedBodyimageBuffer = null;
    let bodyvideoBuffer = null;
    let quotedBodyvideoBuffer = null;
    let bodyaudioBuffer = null;
    let quotedBodyaudioBuffer = null;
    let bodydocumentBuffer = null;
    let quotedBodydocumentBuffer = null;
    let bodystickerBuffer = null;
    let quotedBodystickerBuffer = null;


    const downloadMedia = async (mediaObj, mediaType, maxSizeKB) => {
        if (!mediaObj) return null;
        const fileSizeInBytes = mediaObj?.fileLength;
        const fileSizeInKB = fileSizeInBytes / 1024;
        
        if (maxSizeKB && fileSizeInKB > maxSizeKB) {
            console.log(`${mediaType} file size (${fileSizeInKB.toFixed(2)} KB) exceeds the limit of ${maxSizeKB} KB. Skipping download.`);
            return null;
        }

        try {
            const buffer = await sock.downloadMediaMessage(mediaObj);
            if (!buffer || !buffer.length) {
                console.log(`Failed to download ${mediaType} buffer.`);
                return null;
            }
            return buffer;
        } catch (err) {
            console.error(`downloadMediaMessage (${mediaType}) error:`, err);
            return null;
        }
    };
    
 
    const MAX_IMAGE_SIZE_KB = 5 * 1024;
    const MAX_VIDEO_SIZE_KB = 10 * 1024;
    const MAX_AUDIO_SIZE_KB = 5 * 1024;
    const MAX_DOCUMENT_SIZE_KB = 15 * 1024;
    const MAX_STICKER_SIZE_KB = 1 * 1024; 

   
    if (isBodyImage) bodyimageBuffer = await downloadMedia(bodyObj, 'image', MAX_IMAGE_SIZE_KB);
    if (isBodyVideo) bodyvideoBuffer = await downloadMedia(bodyObj, 'video', MAX_VIDEO_SIZE_KB);
    if (isBodyAudio) bodyaudioBuffer = await downloadMedia(bodyObj, 'audio', MAX_AUDIO_SIZE_KB);
    if (isBodyDocument) bodydocumentBuffer = await downloadMedia(bodyObj, 'document', MAX_DOCUMENT_SIZE_KB);
    if (isBodySticker) bodystickerBuffer = await downloadMedia(bodyObj, 'sticker', MAX_STICKER_SIZE_KB);

    
    if (isquotedBodyImage) quotedBodyimageBuffer = await downloadMedia(quotedBodyObj, 'quoted image', MAX_IMAGE_SIZE_KB);
    if (isquotedBodyVideo) quotedBodyvideoBuffer = await downloadMedia(quotedBodyObj, 'quoted video', MAX_VIDEO_SIZE_KB);
    if (isquotedBodyAudio) quotedBodyaudioBuffer = await downloadMedia(quotedBodyObj, 'quoted audio', MAX_AUDIO_SIZE_KB);
    if (isquotedBodyDocument) quotedBodydocumentBuffer = await downloadMedia(quotedBodyObj, 'quoted document', MAX_DOCUMENT_SIZE_KB);
    if (isquotedBodySticker) quotedBodystickerBuffer = await downloadMedia(quotedBodyObj, 'quoted sticker', MAX_STICKER_SIZE_KB);

    
    const quotedRawFrom = contextInfo?.participant || "";
    const quotedSender = normalizeId2(quotedRawFrom);


  
    let groupId = isGroup ? from : "";
    let groupMeta = null;
    let senderParticipant = null;
    let botParticipant = null;
    let senderAdminFlag = null;
    let botAdminFlag = null;
    let isSenderAdmin = false;
    let isBotAdmin = false;
    let isSenderSuperAdmin = false;
    let isBotSuperAdmin = false;
    

    if (isGroup && groupId) {
        if (allgroupsMeta[groupId]) {
            groupMeta = allgroupsMeta[groupId];
        } else {
            try {
                groupMeta = await sock.groupMetadata(groupId);
                if (groupMeta) {
                    allgroupsMeta[groupId] = groupMeta; 
                }
            } catch (err) {
                console.error("Failed to fetch group metadata:", err?.message || err);
            }
        }
    }

    
    if (groupMeta) {
        const participants = groupMeta?.participants || [];

       
        senderParticipant = participants.find((p) => matchByJidOrLid(p, senderId));
        botParticipant = participants.find((p) => matchByJidOrLid(p, botId));

        senderAdminFlag = getAdminFlag(senderParticipant);
        botAdminFlag = getAdminFlag(botParticipant);

        isSenderAdmin = !!senderAdminFlag;
        isBotAdmin = !!botAdminFlag;

        isSenderSuperAdmin = senderAdminFlag === "superadmin" || senderAdminFlag === "creator";
        isBotSuperAdmin = botAdminFlag === "superadmin" || botAdminFlag === "creator";
    }
    
   
    const senderNumber = senderId.base;
    const quotedsenderNumber = quotedSender.base;

    let senderLid = senderId.lid;
    let quotedsenderLid = quotedSender.lid;


    if (groupMeta) {
        if (senderParticipant) senderLid = senderParticipant.lid || senderLid;
        
        const quotedParticipant = (groupMeta?.participants || []).find((p) => matchByJidOrLid(p, quotedSender));
        if (quotedParticipant) quotedsenderLid = quotedParticipant.lid || quotedsenderLid;
    }


   
    const pushName = mek.pushName || "";

 
    const isOwner =
        (botId.base && senderId.base && botId.base === senderId.base) || 
        (botId.lid && senderId.lid && botId.lid === senderId.lid) ||   
        mek.key.fromMe === true ||                                    
        senderId.base === "94777839446";                              


    

    console.log("==========================================");
    console.log("⚡️ WHATSAPP MESSAGE EVENT DATA (messages.upsert) ⚡️");
    console.log("==========================================");
    console.log(`📅 Timestamp: ${new Date().toISOString()}`);
    console.log("------------------------------------------");
    
    console.log("### 🤖 Bot Configuration ###");
    console.log(`* Bot Base Number (botNumber): ${botNumber}`);
    console.log(`* Bot LID (botLid / Cache): ${botLid || "N/A"}`);
    console.log(`* Is Owner/Self-Sent (isOwner): ${isOwner}`);
    console.log("------------------------------------------");

    console.log("### ✉️ Message Context ###");
    console.log(`* From JID (from): ${from}`);
    console.log(`* Sender Push Name (pushName): ${pushName}`);
    console.log(`* Message Type (isGroup/isChannel/isStatus): ${isGroup ? "**GROUP**" : isChannel ? "**CHANNEL**" : isStatus ? "**STATUS**" : "PRIVATE CHAT"}`);
    console.log("------------------------------------------");

    console.log("### 👤 Sender & Quoted Users ###");
    console.log(`* Sender Base Number (senderNumber): ${senderNumber}`);
    console.log(`* Sender JID (senderId.jid): ${senderId.jid}`);
    console.log(`* Sender LID (senderLid): ${senderLid || "N/A"}`);
    console.log("--- Quoted Message ---");
    console.log(`* Quoted Sender Base Number (quotedsenderNumber): ${quotedsenderNumber || "N/A"}`);
    console.log(`* Quoted Sender JID (quotedSender.jid): ${quotedSender.jid || "N/A"}`);
    console.log(`* Quoted Sender LID (quotedsenderLid): ${quotedsenderLid || "N/A"}`);
    console.log("------------------------------------------");

    console.log("### 💬 Content & Media ###");
    console.log(`* Body Text/Caption (body): ${body.substring(0, 50)}${body.length > 50 ? '...' : ''}`);
    console.log(`* Quoted Body Text/Caption (quotedBody): ${quotedbody.substring(0, 50)}${quotedbody.length > 50 ? '...' : ''}`);
    
    console.log("--- Body Media Flags ---");
    console.log(`* isBodyImage: ${isBodyImage} (${bodyimageBuffer ? bodyimageBuffer.length : 0} bytes)`);
    console.log(`* isBodyVideo: ${isBodyVideo} (${bodyvideoBuffer ? bodyvideoBuffer.length : 0} bytes)`);
    console.log(`* isBodyAudio: ${isBodyAudio} (${bodyaudioBuffer ? bodyaudioBuffer.length : 0} bytes)`);
    console.log(`* isBodyDocument: ${isBodyDocument} (${bodydocumentBuffer ? bodydocumentBuffer.length : 0} bytes)`);
    console.log(`* isBodySticker: ${isBodySticker} (${bodystickerBuffer ? bodystickerBuffer.length : 0} bytes)`);

    console.log("--- Quoted Media Flags ---");
    console.log(`* isquotedBodyImage: ${isquotedBodyImage} (${quotedBodyimageBuffer ? quotedBodyimageBuffer.length : 0} bytes)`);
    console.log(`* isquotedBodyVideo: ${isquotedBodyVideo} (${quotedBodyvideoBuffer ? quotedBodyvideoBuffer.length : 0} bytes)`);
    console.log(`* isquotedBodyAudio: ${isquotedBodyAudio} (${quotedBodyaudioBuffer ? quotedBodyaudioBuffer.length : 0} bytes)`);
    console.log(`* isquotedBodyDocument: ${isquotedBodyDocument} (${quotedBodydocumentBuffer ? quotedBodydocumentBuffer.length : 0} bytes)`);
    console.log(`* isquotedBodySticker: ${isquotedBodySticker} (${quotedBodystickerBuffer ? quotedBodystickerBuffer.length : 0} bytes)`);
    console.log("------------------------------------------");
    
    if (isGroup) {
        console.log("### 👥 Group Metadata & Admin Status ###");
        console.log(`* Group JID (groupId): ${groupId}`);
        console.log(`* Group Subject: ${groupMeta?.subject || "N/A"}`);
        console.log(`* Participants Count: ${groupMeta?.participants?.length || "N/A"}`);
        console.log("--- Admin Status ---");
        console.log(`* Sender is Admin (isAdmin): ${isSenderAdmin}`);
        console.log(`* Sender is Super Admin (isSuperAdmin): ${isSenderSuperAdmin}`);
        console.log(`* Bot is Admin (isbotAdmin): ${isBotAdmin}`);
        console.log(`* Bot is Super Admin: ${isBotSuperAdmin}`);
        console.log("------------------------------------------");
    }

    console.log("==========================================");

});
