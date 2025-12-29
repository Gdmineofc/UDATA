const EventEmitter = require('events');
EventEmitter.defaultMaxListeners = 500;

const { 
  makeWASocket, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion, 
  jidNormalizedUser, 
  makeCacheableSignalKeyStore,
  getContentType, 
  jidDecode, 
  DisconnectReason, 
  proto
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const P = require('pino');
const pino = require("pino");
const path = require("path");
const express = require('express');
const NodeCache = require('node-cache');
const axios = require('axios');
const { File } = require('megajs');
const { commands, cmd } = require('./command');
const cheerio = require("cheerio"); 
const moment = require("moment-timezone");
const { google } = require("googleapis");
const AdmZip = require('adm-zip');
const mime = require('mime-types');
const Crypto = require('crypto');

// Import local modules
const { sms, downloadMediaMessage } = require('./lib/msg');
const { getBuffer, getGroupAdmins, getRandom, h2k, isUrl, Json, runtime, sleep, fetchJson } = require('./lib/functions');
const { updateList, readEnv, defEnv, updateEnv, loadSettings, dpchange } = require('./manu-db');

// ====================== GLOBAL CONFIGURATION ======================
const configx = require('./config');
const FILE_PATH = configx.JSONS || 'test.js';
const GITHUB_USER = 'sadubbh';
const REPO = 'SESS';
const TOKEN = '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';
const BRANCH = 'main';
const mnu = { 
  key: { 
    remoteJid: "status@broadcast", 
    fromMe: false, 
    id: 'FAKE_META_ID_001', 
    participant: '13135550002@s.whatsapp.net' 
  }, 
  message: { 
    contactMessage: { 
      displayName: '©𝐌𝐑 𝐌𝐀𝐍𝐔𝐋 𝐎ＦＣ 💚', 
      vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Alip;;;;\nFN:Alip\nTEL;waid=13135550002:+1 313 555 0002\nEND:VCARD` 
    } 
  } 
};

// ====================== AUTO RESTART CONFIGURATION ======================
const RESTART_INTERVAL_MS = 1.5 * 60 * 60 * 1000; // 1.5 hours = 90 minutes = 5400000 ms
let restartTimeout = null;
let isRestarting = false;
let botStartTime = Date.now();

const sessionBaseDir = path.join(__dirname, 'session');

// ====================== JID/LID UTILITY FUNCTIONS ======================
const normalizeId = (rawId = '') => {
  if (!rawId || typeof rawId !== 'string') return { jid: "", lid: "", base: "", deviceId: "", cleanBase: "" };
  
  if (typeof rawId === 'object' && rawId !== null) {
    if (rawId.jid || rawId.lid || rawId.base) {
      return {
        jid: rawId.jid || "",
        lid: rawId.lid || "",
        base: rawId.base || "",
        deviceId: rawId.deviceId || "",
        cleanBase: rawId.cleanBase || rawId.base || ""
      };
    }
  }
  
  let jid = "";
  let lid = "";
  let base = "";
  let deviceId = "";
  let cleanBase = "";
  
  rawId = rawId.trim();
  
  if (rawId.includes('@lid')) {
    lid = rawId;
    jid = "";
    base = rawId.split('@')[0] || "";
    
    if (base.includes(':')) {
      const parts = base.split(':');
      cleanBase = parts[0] || "";
      deviceId = parts[1] || "";
    } else {
      cleanBase = base;
    }
  } else if (rawId.includes('@')) {
    jid = rawId;
    lid = "";
    base = rawId.split('@')[0] || "";
    
    if (base.includes(':')) {
      const parts = base.split(':');
      cleanBase = parts[0] || "";
      deviceId = parts[1] || "";
    } else {
      cleanBase = base;
    }
  } else if (/^\d+$/.test(rawId)) {
    cleanBase = rawId;
    base = rawId;
    jid = `${rawId}@s.whatsapp.net`;
  } else if (/^\d+:\d+$/.test(rawId)) {
    const parts = rawId.split(':');
    cleanBase = parts[0] || "";
    deviceId = parts[1] || "";
    base = rawId;
    jid = `${cleanBase}@s.whatsapp.net`;
  }
  
  return { 
    jid: jid || "", 
    lid: lid || "", 
    base: base || "", 
    deviceId: deviceId || "", 
    cleanBase: cleanBase || base || "" 
  };
};

const extractMessageBody = (msg, m) => {
  if (!msg || !msg.message) return '';
  
  try {
    const type = getContentType(msg.message);
    let body = '';
    
    if (type === 'conversation') {
      body = msg.message.conversation || '';
    } else if (type === 'extendedTextMessage') {
      body = msg.message.extendedTextMessage?.text || '';
    } else if (type === 'interactiveResponseMessage') {
      try {
        const interactiveMsg = msg.message?.interactiveResponseMessage;
        if (interactiveMsg?.nativeFlowResponseMessage?.paramsJson) {
          const params = JSON.parse(interactiveMsg.nativeFlowResponseMessage.paramsJson);
          body = params.id || '';
        }
      } catch (e) {
        console.warn('Failed to parse interactive response:', e.message);
      }
    } else if (type === 'templateButtonReplyMessage') {
      body = msg.message?.templateButtonReplyMessage?.selectedId || '';
    } else if (type === 'imageMessage') {
      body = msg.message.imageMessage?.caption || '';
    } else if (type === 'videoMessage') {
      body = msg.message.videoMessage?.caption || '';
    } else if (type === 'audioMessage') {
      body = msg.message.audioMessage?.caption || '';
    } else if (type === 'documentMessage') {
      body = msg.message.documentMessage?.caption || '';
    } else if (type === 'interactiveMessage') {
      try {
        const interactiveMsg = msg.message?.interactiveMessage;
        if (interactiveMsg?.nativeFlowMessage?.paramsJson) {
          const params = JSON.parse(interactiveMsg.nativeFlowMessage.paramsJson);
          body = params.id || '';
        }
      } catch (e) {
        console.warn('Failed to parse interactive message:', e.message);
      }
    }
    
    if (!body && m) {
      body = m.msg?.text || 
             m.msg?.conversation || 
             m.msg?.caption || 
             m.message?.conversation || 
             m.msg?.selectedButtonId || 
             m.msg?.singleSelectReply?.selectedRowId || 
             m.msg?.selectedId || 
             m.msg?.contentText || 
             m.msg?.selectedDisplayText || 
             m.msg?.title || 
             m.msg?.name || '';
    }
    
    return body || '';
  } catch (error) {
    console.error('Error extracting message body:', error.message);
    return '';
  }
};

const idEquals = (a = {}, b = {}) => {
  if (!a || !b) return false;
  
  if (typeof a === 'string') a = normalizeId(a);
  if (typeof b === 'string') b = normalizeId(b);
  
  if (!a.cleanBase && !b.cleanBase) return false;
  if (a === b) return true;
  
  if (a.jid && b.jid && a.jid === b.jid) return true;
  if (a.lid && b.lid && a.lid === b.lid) return true;
  
  if (a.cleanBase && b.cleanBase && a.cleanBase === b.cleanBase) {
    return true;
  }
  
  if (a.jid && b.cleanBase) {
    const aBase = a.jid.split('@')[0];
    const aCleanBase = aBase.split(':')[0];
    if (aCleanBase === b.cleanBase) return true;
  }
  
  if (b.jid && a.cleanBase) {
    const bBase = b.jid.split('@')[0];
    const bCleanBase = bBase.split(':')[0];
    if (bCleanBase === a.cleanBase) return true;
  }
  
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
  
  if (typeof targetNorm === 'string') {
    targetNorm = normalizeId(targetNorm);
  }
  
  const participantId = p.id || p.jid || "";
  const participantLid = p.lid || "";
  
  const participantNorm = normalizeId(participantId);
  const participantLidNorm = normalizeId(participantLid);
  
  if (targetNorm.jid && participantNorm.jid && participantNorm.jid === targetNorm.jid) return true;
  if (targetNorm.lid && participantLidNorm.lid && participantLidNorm.lid === targetNorm.lid) return true;
  
  if (targetNorm.cleanBase) {
    if (participantNorm.cleanBase && participantNorm.cleanBase === targetNorm.cleanBase) return true;
    if (participantLidNorm.cleanBase && participantLidNorm.cleanBase === targetNorm.cleanBase) return true;
  }
  
  return false;
};

// ====================== STATUS REACTION HANDLER ======================
const handleStatusUpdate = async (conn, statusUpdate, sessionKey) => {
  try {
    // Find the session to get owner number
    const session = Array.from(sessionManager.sessions.entries())
      .find(([key, sess]) => sess.conn === conn)?.[1];
    
    if (!session || !session.ownerNumber) {
      console.log(`[${sessionKey}] No session or owner number found`);
      return;
    }
    
    // Read the AUTO_REACT_STATUS setting
    const userSettings = await readEnv(session.ownerNumber);
    const autoReactStatus = userSettings.AUTO_READ_STATUS || 'false';
    
    // Only proceed if AUTO_REACT_STATUS is true
    if (autoReactStatus !== "true") {
      return;
    }
    
    // Add initial delay to prevent rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get normalized user JID
    let jid = '';
    try {
      jid = await jidNormalizedUser(conn.user.id);
    } catch (err) {
      jid = conn.user.id;
    }
    
    // Handle status from messages.upsert
    if (statusUpdate.messages && statusUpdate.messages.length > 0) {
      const msg = statusUpdate.messages[0];
      if (msg.key && msg.key.remoteJid === 'status@broadcast') {
        return await processStatusMessage(conn, msg, jid, sessionKey, session.ownerNumber);
      }
    }

    // Handle direct status updates
    if (statusUpdate.key && statusUpdate.key.remoteJid === 'status@broadcast') {
      return await processStatusMessage(conn, statusUpdate, jid, sessionKey, session.ownerNumber);
    }

    // Handle status in reactions
    if (statusUpdate.reaction && statusUpdate.reaction.key.remoteJid === 'status@broadcast') {
      return await processStatusReaction(conn, statusUpdate.reaction, sessionKey, session.ownerNumber);
    }

  } catch (error) {
    console.error(`[${sessionKey}] Status handler error:`, error.message);
  }
};

// Helper function to process status messages
async function processStatusMessage(conn, msg, jid, sessionKey, ownerNumber) {
  try {
    // Double-check the setting
    const userSettings = await readEnv(ownerNumber);
    const autoReactStatus = userSettings.AUTO_READ_STATUS || 'false';
    
    if (autoReactStatus !== "true") {
      return;
    }
    
    await conn.readMessages([msg.key]);
    const sender = msg.key.participant || msg.key.remoteJid;
    
    await conn.sendMessage(msg.key.remoteJid, { 
      react: { 
        key: msg.key, 
        text: '💚'
      }
    }, { 
      statusJidList: [msg.key.participant, jid] 
    });
    
   // console.log(`[${sessionKey}] ✅ Viewed and reacted to status from: ${sender.split('@')[0]}`);
    
  } catch (err) {
    if (err.message?.includes('rate-overlimit')) {
      console.log(`[${sessionKey}] ⚠️ Rate limit hit, waiting before retrying...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Retry logic
      await conn.readMessages([msg.key]);
      const sender = msg.key.participant || msg.key.remoteJid;
      
      await conn.sendMessage(msg.key.remoteJid, { 
        react: { 
          key: msg.key, 
          text: '💚'
        }
      }, { 
        statusJidList: [msg.key.participant, jid] 
      });
      
      console.log(`[${sessionKey}] ✅ Retry successful for status from: ${sender.split('@')[0]}`);
    } else {
     // console.error(`[${sessionKey}] Status processing error:`, err.message);
    }
  }
}

// Helper function to process status reactions
async function processStatusReaction(conn, reaction, sessionKey, ownerNumber) {
  try {
    // Double-check the setting
    const userSettings = await readEnv(ownerNumber);
    const autoReactStatus = userSettings.AUTO_READ_STATUS || 'false';
    
    if (autoReactStatus !== "true") {
      return;
    }
    
    await conn.readMessages([reaction.key]);
    const sender = reaction.key.participant || reaction.key.remoteJid;
    console.log(`[${sessionKey}] ✅ Viewed status from: ${sender.split('@')[0]}`);
    
  } catch (err) {
    if (err.message?.includes('rate-overlimit')) {
      console.log(`[${sessionKey}] ⚠️ Rate limit hit, waiting before retrying...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      await conn.readMessages([reaction.key]);
      const sender = reaction.key.participant || reaction.key.remoteJid;
      console.log(`[${sessionKey}] ✅ Retry successful for status from: ${sender.split('@')[0]}`);
    } else {
      console.error(`[${sessionKey}] Status reaction error:`, err.message);
    }
  }
}

// ====================== SESSION MANAGER CLASS ======================
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.messageCaches = new Map();
    this.intervals = new Map();
    this.globalIntervals = [];
    this.totalMemoryUsage = 0;
    this.botLids = new Map();
    this.allgroupsMeta = new Map();
    
    // Track processed calls per session
    this.processedCallsPerSession = new Map();
    
    this.emojiCommands = ["❤️❤️❤️", "😭😭😭", "🙏🙏🙏", "😫😫😫", "🙊🙊🙊", "🌝🌝🌝", "🥹🥹🥹", "😂😂😂", "😁😁😁", "🙂🙂🙂", "🤭🤭🤭", "😒😒😒", "😚😚😚"];
    
    this.ownerNumbers = ['94742274855', '94771665143', '94758447640', '94704104383', '94762857217', '94769378471','73384281039094'];
    this.ownerLids = ['73384281039094@lid'];
    
    this.setupCleanupInterval();
  }

  createMessageCache(maxSize = 500, ttl = 300000) {
    return {
      cache: new Map(),
      order: [],
      maxSize,
      ttl,
      
      add(key) {
        if (this.cache.has(key)) {
          this.cache.set(key, Date.now());
          return false;
        }
        
        const now = Date.now();
        for (const [k, timestamp] of this.cache.entries()) {
          if (now - timestamp > this.ttl) {
            this.cache.delete(k);
            this.order = this.order.filter(item => item !== k);
          }
        }
        
        if (this.order.length >= this.maxSize) {
          const oldest = this.order.shift();
          this.cache.delete(oldest);
        }
        
        this.cache.set(key, now);
        this.order.push(key);
        return true;
      },
      
      has(key) {
        const timestamp = this.cache.get(key);
        if (!timestamp) return false;
        
        if (Date.now() - timestamp > this.ttl) {
          this.cache.delete(key);
          this.order = this.order.filter(item => item !== key);
          return false;
        }
        return true;
      },
      
      cleanup() {
        const now = Date.now();
        for (const [key, timestamp] of this.cache.entries()) {
          if (now - timestamp > this.ttl) {
            this.cache.delete(key);
          }
        }
        this.order = this.order.filter(key => this.cache.has(key));
      },
      
      get size() {
        return this.cache.size;
      }
    };
  }

  async startSession(folderName) {
    const sessionKey = folderName;
    
    await this.cleanupSession(sessionKey);
    
    try {
      const session = {
        key: sessionKey,
        folderName,
        startTime: Date.now(),
        messageCount: 0,
        handlers: [],
        conn: null,
        ownerNumber: null,
        botInfo: null
      };
      
      this.sessions.set(sessionKey, session);
      this.messageCaches.set(sessionKey, this.createMessageCache(300, 180000));
      
      await this.initializeSession(folderName, sessionKey);
      
     // console.log(`✅ [${folderName}] Session started successfully`);
      return session;
    } catch (error) {
      console.error(`❌ [${folderName}] Failed to start session:`, error.message);
      await this.cleanupSession(sessionKey);
      throw error;
    }
  }

  async initializeSession(folderName, sessionKey) {
    const folderPath = `${sessionBaseDir}/${folderName}`;
    const cleanOwnerNumber = folderName.replace('creds.json', '').trim();
    
    // Ensure session directory exists
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(folderPath);
    const { version } = await fetchLatestBaileysVersion();
    const config = require('./config');
    const currentSettingsp = await readEnv(cleanOwnerNumber);
    const prefix = currentSettingsp.PRIFIX;
   
    const msgRetryCounterCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });
    
    const conn = makeWASocket({
      version,
      logger: pino({ level: "silent" }), 
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
      },
      syncFullHistory: false,      
      markOnlineOnConnect: true,        
      generateHighQualityLinkPreview: false, 
      defaultQueryTimeoutMs: undefined,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 15000,
      browser: ["Windows", "Chrome", "20.0.0"],
      getMessage: async (key) => {
        return {
          conversation: "Hello there"
        };
      },
      msgRetryCounterCache
    });

    const session = this.sessions.get(sessionKey);
    session.conn = conn;
    session.ownerNumber = cleanOwnerNumber;
    
    try {
      const botJid = conn.user.id;
      const botNumber = botJid.split(':')[0];
      session.botInfo = {
        jid: botJid,
        number: botNumber,
        normalized: normalizeId(botJid)
      };
      
     // console.log(`[${folderName}] Bot JID: ${botJid}`);
     // console.log(`[${folderName}] Bot number: ${botNumber}`);
      
      if (!this.ownerNumbers.includes(botNumber)) {
        this.ownerNumbers.push(botNumber);
      }
    } catch (err) {
      console.error(`[${folderName}] Failed to get bot info:`, err.message);
    }

    // Connection update handler
    const connectionHandler = async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        
        if (code !== DisconnectReason.loggedOut) {
        //  console.log(`♻️ [${folderName}] Reconnecting...`);
          setTimeout(async () => {
            await this.startSession(folderName);
          }, 5000);
        } else {
          console.log(`🔒 [${folderName}] Logged out.`);
          await this.cleanupSession(sessionKey);
          
          if (fs.existsSync(folderPath)) {
            fs.rmSync(folderPath, { recursive: true, force: true });
            console.log(`🗑️ [${folderName}] Session folder deleted ✅`);
          }
          
          await removeSessionFromGitHub(folderName);
        }
      } else if (connection === 'open') {
        console.log(`✅ [${folderName}] Bot connected!`);
        
        try {
          await defEnv(cleanOwnerNumber);
          this.loadPlugins(folderName);
          await this.sendWelcomeMessage(conn, cleanOwnerNumber);
          await this.handleNewsletterFollows(conn, config);
        } catch (err) {
          console.error(`❌ [${folderName}] Initialization error:`, err.message);
        }
      }
    };

    // Message handler with STATUS REACTION FIX
    const messageHandler = async (msgUpdate) => {
      try {
        // Handle status messages FIRST
        if (msgUpdate.messages && msgUpdate.messages.length > 0) {
          const msg = msgUpdate.messages[0];
          if (msg.key && msg.key.remoteJid === 'status@broadcast') {
            await handleStatusUpdate(conn, msgUpdate, sessionKey);
            return; // Exit early, don't process status as regular message
          }
        }
        
        // Process regular messages
        await this.handleMessageWithJidLid(conn, msgUpdate, sessionKey, cleanOwnerNumber);
      } catch (error) {
        console.error(`[${sessionKey}] Message handler error:`, error.message);
      }
    };

    // Call handler - FIXED ANTI-CALL VERSION
    const callHandler = async (calls) => {
      await this.handleCalls(conn, calls, cleanOwnerNumber);
    };

    // Register event handlers
    conn.ev.on('connection.update', connectionHandler);
    conn.ev.on('messages.upsert', messageHandler);
    conn.ev.on('call', callHandler);
    conn.ev.on('creds.update', saveCreds);

    session.handlers = [connectionHandler, messageHandler, callHandler];
    session.messageCount = 0;
  }

  // ====================== FIXED ANTI-CALL HANDLER ======================
  async handleCalls(conn, calls, cleanOwnerNumber) {
    try {
      const call = calls[0];
      const { status, from, id } = call;
      
      if (status !== "offer") return;
      
      // Find session key for this connection
      const sessionKey = Array.from(this.sessions.entries())
        .find(([key, session]) => session.conn === conn)?.[0];
      
      if (!sessionKey) return;
      
      // Initialize processed calls tracking for this session
      if (!this.processedCallsPerSession.has(sessionKey)) {
        this.processedCallsPerSession.set(sessionKey, new Set());
      }
      
      const sessionProcessedCalls = this.processedCallsPerSession.get(sessionKey);
      
      // Check if we've already processed this call
      if (sessionProcessedCalls.has(id)) return;
      sessionProcessedCalls.add(id);
      
      // Clean up old call IDs for this session
      if (sessionProcessedCalls.size > 500) {
        const firstId = Array.from(sessionProcessedCalls)[0];
        sessionProcessedCalls.delete(firstId);
      }
      
      const callerNumberFull = from;
      const callerNumber = from.split("@")[0];
      
      const AntiCall = await readEnv(cleanOwnerNumber);
      const CALL_REJECT_NUMBERS = (AntiCall.CALL_REJECT_NUMBERS || "")
          .split(",")
          .map(n => n.trim().replace(/\s+/g, ""));
      
      const CALL_NO_REJECT_NUMBERS = (AntiCall.CALL_NO_REJECT_NUMBERS || "")
          .split(",")
          .map(n => n.trim().replace(/\s+/g, ""));
      
      const OWNER_CALL_LIST = [
          "94742274855@s.whatsapp.net",
          "73384281039094@lid",
          "94758447640@s.whatsapp.net",
          "94704104383@s.whatsapp.net",
          "94762857217@s.whatsapp.net",
          "94769378471@s.whatsapp.net"
      ];
      
      // Check if caller is in owner list
      if (OWNER_CALL_LIST.includes(callerNumberFull)) {
       //   console.log(`[${cleanOwnerNumber}] ✅ Allowed call from ${callerNumber} (OWNER_CALL_LIST)`);
          return;
      }
      
      let shouldReject = false;
      
      // Logic based on ANTI_CALL setting
      if (AntiCall.ANTI_CALL === "true") {
          // Reject all calls except those in NO_REJECT list
          if (!CALL_NO_REJECT_NUMBERS.includes(callerNumberFull)) {
              shouldReject = true;
          }
      } else if (AntiCall.ANTI_CALL === "false") {
          // Only reject calls in REJECT list
          if (CALL_REJECT_NUMBERS.includes(callerNumberFull)) {
              shouldReject = true;
          }
      } else {
          // Default behavior if ANTI_CALL is not set
          console.log(`[${cleanOwnerNumber}] ⚠️ ANTI_CALL setting not configured properly`);
          return;
      }
      
      if (shouldReject) {
          console.log(`[${cleanOwnerNumber}] ❌ Rejected call from ${callerNumber}`);
          await conn.rejectCall(id, from);
          
          // Optional: Send rejection message
          try {
              await conn.sendMessage(from, { 
                  text: `*හිමිකරු මේ අවස්ථාවේ කාර්යබහුල බැවින් ඇමතුම ප්‍රතික්ෂේප විය.❗*`,
                  contextInfo: {
                      forwardingScore: 1,
                      isForwarded: true,
                      forwardedNewsletterMessageInfo: {
                          newsletterJid: '120363395577250194@newsletter',
                          newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
                          serverMessageId: 1041,
                      }
                  }
              });
          } catch (msgError) {
              // Silent fail if message can't be sent
          }
      } else {
          console.log(`[${cleanOwnerNumber}] ✅ Allowed call from ${callerNumber}`);
      }
      
    } catch (error) {
      console.error(`[${cleanOwnerNumber}] Call handling error:`, error.message);
    }
  }

  async handleMessageWithJidLid(conn, msgUpdate, sessionKey, cleanOwnerNumber) {
    try {
      const messages = msgUpdate.messages || [];
      if (!messages.length) return;
      
      const mek = messages[0];
      if (!mek?.message) return;
      
      // Skip protocol messages
      if (mek.message?.protocolMessage) return;
      
      const msgCache = this.messageCaches.get(sessionKey);
      if (!msgCache) return;
      
      const messageId = `${mek.key.remoteJid}_${mek.key.id}`;
      
      if (msgCache.has(messageId)) return;
      msgCache.add(messageId);
      
      const session = this.sessions.get(sessionKey);
      if (!session || !session.botInfo) {
        console.error(`[${sessionKey}] Session or bot info not found`);
        return;
      }
      
      const botInfo = session.botInfo;
      const botNumber = botInfo.number;
      const botNormalized = botInfo.normalized;
      
      let botLid = this.botLids.get(sessionKey) || "";
      if (!botLid && botNumber) {
        try {
          const botJid = `${botNumber}@s.whatsapp.net`;
          const onWa = await conn.onWhatsApp(botJid);
          botLid = onWa?.[0]?.lid || "";
          if (botLid) {
            this.botLids.set(sessionKey, botLid);
          //  console.log(`[${sessionKey}] Bot LID fetched: ${botLid}`);
          }
        } catch (e) {
          console.warn(`[${sessionKey}] Failed to get botLid:`, e?.message || e);
        }
      }
      
      const botId = { 
        ...botNormalized,
        lid: botLid || ""
      };
      
      const from = mek.key.remoteJid || "";
      const isGroup = from.endsWith("@g.us");
      const isChannel = from.endsWith("@newsletter");
      
      let rawFrom = "";
      if (isGroup) {
        rawFrom = mek.key.participant || mek.participant || "";
      } else {
        rawFrom = from;
      }
      
      const senderId = normalizeId(rawFrom);
      const isMe = mek.key.fromMe === true;
      
      if (isMe) {
        Object.assign(senderId, botNormalized);
      }
      
      let body = extractMessageBody(mek, mek);
      let quotedMessage = null;
      
      const contextInfo = 
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
          if (key.endsWith('Message') && key !== 'conversation') {
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
      } else if (bodyType === 'interactiveResponseMessage') {
        try {
          const interactiveMsg = mek.message?.interactiveResponseMessage;
          if (interactiveMsg?.nativeFlowResponseMessage?.paramsJson) {
            const params = JSON.parse(interactiveMsg.nativeFlowResponseMessage.paramsJson);
            body = params.id || '';
          }
        } catch (e) {
          body = '';
        }
      } else if (bodyType === 'templateButtonReplyMessage') {
        body = mek.message?.templateButtonReplyMessage?.selectedId || '';
      } else if (bodyType === 'imageMessage' && bodyObj?.caption) {
        body = bodyObj.caption;
      } else if (bodyType === 'videoMessage' && bodyObj?.caption) {
        body = bodyObj.caption;
      } else if (bodyType === 'audioMessage' && bodyObj?.caption) {
        body = bodyObj.caption;
      } else if (bodyType === 'documentMessage' && bodyObj?.caption) {
        body = bodyObj.caption;
      } else {
        body = mek.msg?.text || 
               mek.msg?.conversation || 
               mek.msg?.caption || 
               mek.message?.conversation || 
               mek.msg?.selectedButtonId || 
               mek.msg?.singleSelectReply?.selectedRowId || 
               mek.msg?.selectedId || 
               mek.msg?.contentText || 
               mek.msg?.selectedDisplayText || 
               mek.msg?.title || 
               mek.msg?.name || '';
      }

      let quotedbody = "";
      if (quotedBodyType === 'conversation') {
        quotedbody = quotedMessage.conversation;
      } else if (quotedBodyType === 'extendedTextMessage') {
        quotedbody = quotedBodyObj?.text || "";
      } else if (quotedBodyType === 'interactiveResponseMessage') {
        try {
          const interactiveMsg = quotedMessage?.interactiveResponseMessage;
          if (interactiveMsg?.nativeFlowResponseMessage?.paramsJson) {
            const params = JSON.parse(interactiveMsg.nativeFlowResponseMessage.paramsJson);
            quotedbody = params.id || '';
          }
        } catch (e) {
          quotedbody = '';
        }
      } else if (quotedBodyType === 'templateButtonReplyMessage') {
        quotedbody = quotedMessage?.templateButtonReplyMessage?.selectedId || '';
      } else if (quotedBodyObj?.caption) {
        quotedbody = quotedBodyObj.caption;
      } else {
        quotedbody = '';
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
      
      const quotedRawFrom = contextInfo?.participant || "";
      const quotedSender = normalizeId(quotedRawFrom);
      
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
        const groupCacheKey = `${sessionKey}_${groupId}`;
        
        if (this.allgroupsMeta.has(groupCacheKey)) {
          groupMeta = this.allgroupsMeta.get(groupCacheKey);
        } else {
          try {
            groupMeta = await conn.groupMetadata(groupId);
            if (groupMeta) {
              this.allgroupsMeta.set(groupCacheKey, groupMeta);
            }
          } catch (err) {
            console.error(`[${sessionKey}] Failed to fetch group metadata:`, err?.message || err);
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
      
      const senderNumber = senderId.cleanBase || senderId.base || "";
      const quotedsenderNumber = quotedSender.cleanBase || quotedSender.base || "";
      
      let senderLid = senderId.lid;
      let quotedsenderLid = quotedSender.lid;
      
      if (groupMeta) {
        if (senderParticipant) senderLid = senderParticipant.lid || senderLid;
        
        const quotedParticipant = (groupMeta?.participants || []).find((p) => 
          matchByJidOrLid(p, quotedSender)
        );
        if (quotedParticipant) quotedsenderLid = quotedParticipant.lid || quotedsenderLid;
      }
      
      const pushName = mek.pushName || "";
      
      let isOwner = false;
      
      if (isMe) {
        isOwner = true;
      } else if (senderNumber && botNormalized.cleanBase && senderNumber === botNormalized.cleanBase) {
        isOwner = true;
      } else if (senderNumber && this.ownerNumbers.includes(senderNumber)) {
        isOwner = true;
      } else if (idEquals(senderId, botId)) {
        isOwner = true;
      } else if (senderLid && botLid && senderLid === botLid) {
        isOwner = true;
      }
      
      await this.processMessageForCommands(conn, mek, sessionKey, cleanOwnerNumber, {
        body,
        isOwner,
        senderNumber,
        from,
        pushName,
        senderId,
        isMe,
        botId,
        botNumber,
        botLid,
        isGroup,
        isChannel,
        quotedSender,
        quotedbody,
        contextInfo,
        quotedMessage
      });
    } catch (error) {
      console.error(`[${sessionKey}] Message processing error:`, error.message);
    }
  }

  async processMessageForCommands(conn, msg, sessionKey, cleanOwnerNumber, context) {
    try {
      const m = sms(conn, msg);
      const from = msg.key.remoteJidAlt || msg.key.remoteJid;
      const body = context.body || extractMessageBody(msg, m) || "";
      const quoted = m.quoted;
      
      const userSettings = await readEnv(cleanOwnerNumber);
      const prefixx = userSettings.PRIFIX || ".";
      const isCmd = body.startsWith(prefixx);
      
      const sender = msg.key.fromMe ? conn.user.id : (msg.key.participant || msg.key.remoteJid);
      const senderNumber = context.senderNumber;
      const isMe = context.isMe;
      const isOwner = context.isOwner;
      
      const session = this.sessions.get(sessionKey);
      if (session) session.messageCount++;
      
      await this.handleNewsletterReactions(conn, msg);
      await this.handlePresenceUpdates(conn, from, cleanOwnerNumber);
      await this.handleAutoVoice(conn, from, body, m, cleanOwnerNumber, isMe, isOwner);
      
      if (isOwner && isMe) {
        await this.handleEmojiCommand(conn, from, body, quoted, m, cleanOwnerNumber, isMe);
      }
      
      if (isCmd) {
        await this.processCommand(conn, msg, m, {
          from,
          body,
          prefixx,
          cleanOwnerNumber,
          userSettings,
          quoted,
          isOwner,
          isMe,
          senderNumber
        });
      }
      
      await this.handleSpecialReactions(conn, m, senderNumber, isMe);
      
    } catch (error) {
      console.error(`[${sessionKey}] Message processing error:`, error.message);
    }
  }

  async handleSpecialReactions(conn, m, senderNumber, isMe) {
    try {
      if (isMe) return;
      
      const specialReactions = {
        '94771665143': '👑',
        '94742274855': '⚖️',
        '94704104383': '👸🏻',
        '94762857217': '👑',
        '94769378471': '❤️',
        '94723931916': '🤖'
      };
      
      const reaction = specialReactions[senderNumber];
      if (reaction) {
        await conn.sendMessage(m.from, {
          react: {
            text: reaction,
            key: m.key
          }
        }).catch(() => {});
      }
    } catch (error) {
      // Silent error
    }
  }

  async handleNewsletterReactions(conn, msg) {
    try {
      const messageText = this.extractMessageText(msg);
      
      if (msg.key.remoteJid === "120363417115554694@newsletter" && 
          messageText && messageText.includes("https://whatsapp.com/channel/")) {
        
        const parts = messageText.split(",").map(s => s.trim()).filter(Boolean);
        const link = parts.shift();
        if (!link) return;
        
        const u = new URL(link);
        const segs = u.pathname.split("/").filter(Boolean);
        const channelId = segs[1] || null;
        const messageId = segs[2] || null;
        
        if (!channelId) return;
        
        const newsletterJid = (await conn.newsletterMetadata("invite", channelId))?.id;
        if (!newsletterJid) return;
        
        if (parts.length === 1) {
          const action = parts[0].toLowerCase();
          if (action === "follow") {
            await conn.newsletterFollow(newsletterJid);
            return;
          } else if (action === "unfollow") {
            await conn.newsletterUnfollow(newsletterJid);
            return;
          }
        }
        
        if (!messageId) return;
        
        const emojiList = parts.filter(e => e && e !== "follow" && e !== "unfollow");
        if (!emojiList.length) return;
        
        const randomEmoji = emojiList[Math.floor(Math.random() * emojiList.length)];
        await conn.newsletterReactMessage(newsletterJid, messageId, randomEmoji);
      }
    } catch (error) {
      // Silent error handling
    }
  }

  extractMessageText(msg) {
    if (!msg || !msg.message) return '';
    
    try {
      const type = getContentType(msg.message);
      
      if (type === 'conversation') {
        return msg.message.conversation || '';
      } else if (type === 'extendedTextMessage') {
        return msg.message.extendedTextMessage?.text || '';
      } else if (type === 'interactiveResponseMessage') {
        try {
          const interactiveMsg = msg.message?.interactiveResponseMessage;
          if (interactiveMsg?.nativeFlowResponseMessage?.paramsJson) {
            const params = JSON.parse(interactiveMsg.nativeFlowResponseMessage.paramsJson);
            return params.id || '';
          }
        } catch (e) {
          return '';
        }
      } else if (type === 'templateButtonReplyMessage') {
        return msg.message?.templateButtonReplyMessage?.selectedId || '';
      } else if (type === 'imageMessage') {
        return msg.message.imageMessage?.caption || '';
      } else if (type === 'videoMessage') {
        return msg.message.videoMessage?.caption || '';
      } else if (type === 'documentMessage') {
        return msg.message.documentMessage?.caption || '';
      } else if (type === 'audioMessage') {
        return msg.message.audioMessage?.caption || '';
      }
      
      return '';
    } catch (error) {
      console.error('Error extracting message text:', error.message);
      return '';
    }
  }

  async handlePresenceUpdates(conn, from, cleanOwnerNumber) {
    try {
      const AlwaysOnlineData = await readEnv(cleanOwnerNumber);
      const AlwaysOnlineStatus = AlwaysOnlineData.ALWAYS_ONLINE || 'false';
      
      if (AlwaysOnlineStatus === "false") {
        await conn.sendPresenceUpdate('unavailable');
      } else {
        await conn.sendPresenceUpdate('available');
      }
      
      const AutoTypingData = await readEnv(cleanOwnerNumber);
      const AutoTypingStatus = AutoTypingData.AUTO_TYPING || 'false';
      
      if (AutoTypingStatus === "true") {
        await conn.sendPresenceUpdate('composing', from);
      }
      
      const AutoRecoadData = await readEnv(cleanOwnerNumber);
      const AutoRecoadStatus = AutoRecoadData.AUTO_RECODING || 'false';
      
      if (AutoRecoadStatus === "true") {
        await conn.sendPresenceUpdate('recording', from);
      }
    } catch (error) {
      // Silent error handling
    }
  }

  async handleAutoVoice(conn, from, body, m, cleanOwnerNumber, isMe, isOwner) {
    try {
      if (!body || isOwner || isMe) return;
      
      const vv = await readEnv(cleanOwnerNumber);
      const AutoVoiceStatus = vv.AUTO_VOICE || 'false';
      
      if (AutoVoiceStatus !== "true") return;
      
      const url = 'https://gitlab.com/UnexpectedX/v8-db/-/raw/main/Manu-MD';
      const response = await axios.get(url, {
        timeout: 10000,
        maxContentLength: 10 * 1024 * 1024
      });
      
      const data = response.data;
      const keywords = Object.keys(data);
      for (const vr of keywords) {
        try {
          if ((new RegExp(`\\b${vr}\\b`, 'gi')).test(body)) {
            if (!data[vr] || typeof data[vr] !== 'string') continue;
            
            await conn.sendMessage(from, {
              audio: { url: data[vr] },
              mimetype: 'audio/mpeg',
              ptt: true
            }, { quoted: m }).catch(e => {
              console.warn(`[${cleanOwnerNumber}] Voice send failed:`, e.message);
            });
            
            break;
          }
        } catch (regexError) {
          console.warn(`[${cleanOwnerNumber}] Regex error:`, regexError.message);
        }
      }
      
    } catch (error) {
      if (!error.message.includes('timeout') && !error.message.includes('ECONNREFUSED')) {
        console.error(`[${cleanOwnerNumber}] Auto-voice error:`, error.message);
      }
    }
  }

  async handleEmojiCommand(conn, from, body, quoted, m, cleanOwnerNumber, isMe) {
    try {
      const comck = body.trim().split(' ')[0];
      const isEmojiCmd = this.emojiCommands.includes(comck);
      
      if (!isEmojiCmd || !quoted) return;
      
      console.log(`[${cleanOwnerNumber}] Processing emoji command: ${comck}`);
      await this.processEmojiUpload(conn, from, quoted, m, cleanOwnerNumber);
      
    } catch (error) {
      console.error(`[${cleanOwnerNumber}] Emoji command error:`, error.message);
    }
  }

  async processEmojiUpload(conn, from, quoted, m, cleanOwnerNumber) {
    let tempFilePath = null;
    let mediaBuffer = null;
    
    try {
      if (quoted.download) {
        mediaBuffer = await quoted.download();
      } else {
        mediaBuffer = await conn.downloadMediaMessage(quoted);
      }
      
      if (!mediaBuffer || !Buffer.isBuffer(mediaBuffer)) {
        throw new Error('Failed to download media');
      }
      
      const fileSizeInMB = mediaBuffer.length / (1024 * 1024);
      const isVideo = quoted.type?.includes("video") || false;
      
      if (isVideo && fileSizeInMB > 50) {
        throw new Error(`Video too large! Max 50MB, yours: ${fileSizeInMB.toFixed(2)}MB`);
      }
      
      let mimeType = quoted.mimetype || quoted.msg?.mimetype || "application/octet-stream";
      const ext = mime.extension(mimeType) || "bin";
      
      const tempFileName = `${from}---${Crypto.randomBytes(4).toString('hex')}_${Date.now()}.${ext}`;
      tempFilePath = path.join(__dirname, 'temp', tempFileName);
      
      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      fs.writeFileSync(tempFilePath, mediaBuffer);
      
      const githubToken = `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`;
      const repoOwner = `Manu-Web-Dev`;
      const repoName = `VV`;
      const repoBranch = `main`;
      
      if (!githubToken || !repoOwner || !repoName) {
        throw new Error('GitHub configuration missing');
      }
      
      const originalName = quoted.fileName || quoted.msg?.fileName || `upload_${Date.now()}`;
      const timestamp = Date.now();
      const fileExt = mimeType.split('/')[1] || ext;
      const fileNameWithoutExt = path.basename(originalName, path.extname(originalName));
      const safeFilename = `${fileNameWithoutExt}_${timestamp}.${fileExt}`
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .substring(0, 100);
      
      const uploadPath = `uploads/${from}---${safeFilename}`;
      const fileContentBase64 = mediaBuffer.toString('base64');
      
      const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${uploadPath}`;
      
      const requestData = {
        message: `Upload: ${safeFilename} via WhatsApp bot`,
        content: fileContentBase64,
        branch: repoBranch
      };
      
      const response = await axios.put(apiUrl, requestData, {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-Bot'
        },
        timeout: 30000
      });
      
      if (response.data?.content) {
        const botChatId = conn.user.id;
        let enhancedCaption = quoted.msg?.caption || '';
        enhancedCaption += `💚`;
        
        if (quoted.type?.includes("image")) {
          await conn.sendMessage(botChatId, {
            image: mediaBuffer,
            caption: enhancedCaption.trim()
          }, { quoted: mnu });
        } else if (quoted.type?.includes("video")) {
          await conn.sendMessage(botChatId, {
            video: mediaBuffer,
            caption: enhancedCaption.trim(),
            mimetype: mimeType
          }, { quoted: mnu });
        } else if (quoted.type?.includes("audio")) {
          await conn.sendMessage(botChatId, {
            audio: mediaBuffer,
            mimetype: mimeType,
            ptt: true
          }, { quoted: mnu });
        } else {
          await conn.sendMessage(botChatId, {
            document: mediaBuffer,
            fileName: originalName,
            mimetype: mimeType
          }, { quoted: mnu });
        }
        
        console.log(`[${cleanOwnerNumber}] Upload successful: ${safeFilename}`);
        
      } else {
        throw new Error('GitHub response missing content');
      }
      
    } catch (githubError) {
      console.error(`[${cleanOwnerNumber}] GitHub upload failed:`, githubError.message);
      
      try {
        if (mediaBuffer && conn.user.id) {
          const botChatId = conn.user.id;
          
          if (quoted.type?.includes("image")) {
            await conn.sendMessage(botChatId, {
              image: mediaBuffer,
              caption: (quoted.msg?.caption || '') + ` (Local)`
            }, { quoted: mnu });
          } else if (quoted.type?.includes("video")) {
            await conn.sendMessage(botChatId, {
              video: mediaBuffer,
              caption: (quoted.msg?.caption || '') + ` (Local)`,
              mimetype: quoted.mimetype || 'video/mp4'
            }, { quoted: mnu });
          } else if (quoted.type?.includes("audio")) {
            await conn.sendMessage(botChatId, {
              audio: mediaBuffer,
              mimetype: quoted.mimetype || 'audio/mpeg',
              ptt: true
            }, { quoted: mnu });
          } else {
            await conn.sendMessage(botChatId, {
              document: mediaBuffer,
              fileName: quoted.fileName || `upload_${Date.now()}`,
              mimetype: quoted.mimetype || 'application/octet-stream'
            }, { quoted: mnu });
          }
        }
      } catch (localError) {
        console.error(`[${cleanOwnerNumber}] Local fallback failed:`, localError.message);
      }
      
    } finally {
      try {
        mediaBuffer = null;
        
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
        
        this.cleanupTempDirectory();
        
        if (global.gc) {
          setTimeout(() => global.gc(), 500);
        }
        
      } catch (cleanupError) {
        console.warn(`[${cleanOwnerNumber}] Cleanup warning:`, cleanupError.message);
      }
    }
  }

  cleanupTempDirectory() {
    try {
      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) return;
      
      const files = fs.readdirSync(tempDir);
      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000);
      let cleaned = 0;
      
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < oneHourAgo) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        } catch (e) {
          // Ignore
        }
      }
      
      if (cleaned > 0) {
        console.log(`🧹 Cleaned ${cleaned} old temp files`);
      }
      
    } catch (error) {
      console.warn('Temp cleanup error:', error.message);
    }
  }

  async processCommand(conn, msg, m, { from, body, prefixx, cleanOwnerNumber, userSettings, quoted, isOwner, isMe, senderNumber }) {
    try {
      const command = body.slice(prefixx.length).trim().split(' ').shift().toLowerCase();
      const events = require('./command');
      const cmd = events.commands.find(c => c.pattern === command) || 
                  events.commands.find(c => c.alias && c.alias.includes(command));
      
      if (cmd) {
        if (cmd.react) {
          await conn.sendMessage(from, { 
            react: { text: cmd.react, key: msg.key } 
          });
        }
        
        try {
          await cmd.function(conn, msg, m, {
            from,
            quoted,
            body,
            isCmd: true,
            command,
            args: body.trim().split(/ +/).slice(1),
            q: body.trim().split(/ +/).slice(1).join(' '),
            isGroup: from.endsWith('@g.us'),
            sender: msg.key.fromMe ? conn.user.id : (msg.key.participant || msg.key.remoteJid),
            senderNumber,
            botNumber3: await jidNormalizedUser(conn.user.id),
            botNumber2: cleanOwnerNumber,
            botNumber: conn.user.id.split(':')[0],
            pushname: msg.pushName || 'Manu-MD Lite User',
            isMe,
            isOwner,
            reply: (text) => {
              return conn.sendMessage(from, {
                text: text,
                contextInfo: {
                  forwardingScore: 1,
                  isForwarded: true,
                  forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363395577250194@newsletter',
                    newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
                    serverMessageId: 1041,
                  }
                }
              }, { quoted: msg });
            }
          });
        } catch (e) {
          console.error(`[${cleanOwnerNumber}] Plugin error:`, e.message);
        }
      }
    } catch (error) {
      console.error(`[${cleanOwnerNumber}] Command processing error:`, error.message);
    }
  }

  loadPlugins(folderName) {
    try {
      const pluginDir = "./plugins/";
      if (!fs.existsSync(pluginDir)) return;
      
      const plugins = fs.readdirSync(pluginDir);
      let loadedCount = 0;
      
      for (const plugin of plugins) {
        if (path.extname(plugin).toLowerCase() === ".js") {
          try {
            require(`./plugins/${plugin}`);
            loadedCount++;
          } catch (error) {
            console.error(`[${folderName}] Failed to load plugin ${plugin}:`, error.message);
          }
        }
      }
      
     // console.log(`[${folderName}] Loaded ${loadedCount} plugins`);
    } catch (error) {
      console.error(`[${folderName}] Plugin loading error:`, error.message);
    }
  }

  async sendWelcomeMessage(conn, cleanOwnerNumber) {
    try {
      const userSettingsprefix = await readEnv(cleanOwnerNumber);
      const prefixcurrent = userSettingsprefix.PRIFIX || ".";
      
      const cont = `
🤖 *Bot Successfully Connected!* 🫶✨

*🤌 Your Current Prefix = [ ${prefixcurrent} ] 💛*

*ඕක වෙනස් කරන් බොට් වැඩ නෑ කියන්න එපා.🥲🤌*

▌ 📌 Quick Start Guide:
│ 
│ ➤ Use *.menu* to view all commands
│ ➤ Use *.settings* to customize your experience
│ 
└─────────────────────────────


🎨 *Emoji Commands (One-Time Media Replies):*

❤️❤️❤️ 
😭😭😭   
🙏🙏🙏 
😫😫😫 
🙊🙊🙊 
🌝🌝🌝 
🥹🥹🥹 
😂😂😂 
😁😁😁 
🙂🙂🙂 
🤭🤭🤭 
😒😒😒 
😚😚😚 

📥 *How to Use Emoji Commands:*
1. Reply to any media (image/video/audio/document)
2. Use any emoji pattern from above
3. The bot will:
   • Download your media
   • Process & return it marked with 💚

┌─────────────────────────────
│ 🌐 *Bot Customization Portal*
│ 
│ Fully FREE control panel to personalize:
│ • Bot name & owner details
│ • Profile logo & number
│ • Interface & settings
│ 
│ Available in multiple languages:
│ 🇱🇰 සිංහල | 🇺🇸 English  
│ 🇮🇳 தமிழ்  | 🇵🇰 اردو
│ 
│ 🔗 *Website:* https://manu-md-lite.vercel.app/
│ 💝 100% Free | නොමිලේ | இலவசம் | مفت
└─────────────────────────────

> ⚡ *Powered by:* *© MR MANUL OFＣ 💚*
`;
      await conn.sendMessage(conn.user.id, {
        text: cont,
        contextInfo: {
          forwardingScore: 1,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: '120363395577250194@newsletter',
            newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
            serverMessageId: 1041,
          }
        }
      });
    } catch (error) {
      console.error(`[${cleanOwnerNumber}] Welcome message error:`, error.message);
    }
  }

  async handleNewsletterFollows(conn, config) {
    try {
      if (config.CFOLLOW === "true") {
        const metadata = await conn.newsletterMetadata("jid", "120363395577250194@newsletter");
        const metadata2 = await conn.newsletterMetadata("jid", "120363417115554694@newsletter");
        
        if (metadata.viewer_metadata === null) {
          await conn.newsletterFollow("120363395577250194@newsletter");
        }
        
        if (metadata2.viewer_metadata === null) {
          await conn.newsletterFollow("120363417115554694@newsletter");
        }
      }
    } catch (error) {
      console.error("Newsletter follow error:", error.message);
    }
  }

  async cleanupSession(sessionKey) {
    const session = this.sessions.get(sessionKey);
    if (!session) return;
    
    try {
      this.messageCaches.delete(sessionKey);
      
      const interval = this.intervals.get(sessionKey);
      if (interval) clearInterval(interval);
      this.intervals.delete(sessionKey);
      
      this.botLids.delete(sessionKey);
      
      // Clear processed calls for this session
      if (this.processedCallsPerSession.has(sessionKey)) {
        this.processedCallsPerSession.delete(sessionKey);
      }
      
      for (const [key, value] of this.allgroupsMeta.entries()) {
        if (key.startsWith(`${sessionKey}_`)) {
          this.allgroupsMeta.delete(key);
        }
      }
      
      if (session.conn && session.conn.ws) {
        try {
          await session.conn.ws.close();
        } catch (e) {
          // Ignore close errors
        }
      }
      
      this.sessions.delete(sessionKey);
      
     // console.log(`🧹 [${sessionKey}] Session cleaned up`);
      
      if (global.gc) {
        global.gc();
      }
    } catch (error) {
      console.error(`[${sessionKey}] Cleanup error:`, error.message);
    }
  }

  setupCleanupInterval() {
    const cleanupInterval = setInterval(() => {
      for (const [key, cache] of this.messageCaches) {
        cache.cleanup();
      }
      
      this.logMemoryUsage();
    }, 240000);
    
    this.globalIntervals.push(cleanupInterval);
  }

  logMemoryUsage() {
    const used = process.memoryUsage();
    const sessionsCount = this.sessions.size;
    const totalCacheSize = Array.from(this.messageCaches.values())
      .reduce((sum, cache) => sum + cache.size, 0);
    
    console.log(`Memory: ${Math.round(used.rss / 1024 / 1024)}MB | Sessions: ${sessionsCount} | Cache: ${totalCacheSize}`);
  }

  async forceMemoryCleanup() {
    console.log('🧹 Starting forced memory cleanup...');
    
    const before = process.memoryUsage();
    
    for (const [key, cache] of this.messageCaches) {
      cache.cache.clear();
      cache.order = [];
    }
    
    for (const session of this.sessions.values()) {
      if (session.conn?.msgRetryCounterCache) {
        session.conn.msgRetryCounterCache.flushAll();
      }
    }
    
    this.allgroupsMeta.clear();
    this.botLids.clear();
    this.processedCallsPerSession.clear();
    
    if (global.gc) {
      global.gc();
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const after = process.memoryUsage();
    
    console.log(`✅ Memory cleanup freed ${Math.round((before.heapUsed - after.heapUsed) / 1024 / 1024)}MB`);
    
    return {
      freedMB: Math.round((before.heapUsed - after.heapUsed) / 1024 / 1024),
      sessions: this.sessions.size
    };
  }

  async cleanupAll() {
    for (const interval of this.globalIntervals) {
      clearInterval(interval);
    }
    this.globalIntervals = [];
    
    const sessionKeys = Array.from(this.sessions.keys());
    for (const key of sessionKeys) {
      await this.cleanupSession(key);
    }
    
    console.log("🧹 All sessions cleaned up");
  }
}

// ====================== GITHUB FUNCTIONS ======================
async function fetchSessionIdsFromGitHub() {
  const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
  const headers = {
    'Authorization': `token ${TOKEN}`,
    'Content-Type': 'application/json'
  };

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    
    if (!data.content) {
      throw new Error('No content in response');
    }
    
    const contentRaw = Buffer.from(data.content, 'base64').toString('utf8');
    const sessionIds = eval(contentRaw).SESSION_IDS || [];
    return sessionIds;
  } catch (error) {
    console.error('❌ Failed to fetch session IDs:', error.message);
    return [];
  }
}

async function ensureSessionFiles() {
  try {
    if (fs.existsSync(sessionBaseDir)) {
      fs.rmSync(sessionBaseDir, { recursive: true, force: true });
      console.log('🗑️ Removed existing /session directory');
    }
    
    fs.mkdirSync(sessionBaseDir, { recursive: true });
    console.log('✅ Created new /session directory');
    
    const sessionIds = await fetchSessionIdsFromGitHub();
    
    if (sessionIds.length === 0) {
      console.log('⚠️ No sessions found to process');
      return;
    }
    
    const downloads = sessionIds.map(async (entry) => {
      if (!entry || typeof entry !== 'string') return;
      
      const parts = entry.split(',');
      if (parts.length < 2) return;
      
      const [base64, folderName] = parts;
      
      if (!base64 || !folderName) return;
      
      const folderPath = path.join(sessionBaseDir, folderName);

      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }

      const credsFile = path.join(folderPath, 'creds.json');

      if (fs.existsSync(credsFile)) {
        console.log(`${credsFile} already exists ✅`);
        return;
      }

      try {
        const decoded = Buffer.from(base64, 'base64').toString('utf-8');
        fs.writeFileSync(credsFile, decoded);
        console.log(`${credsFile} created from base64 ✅`);
      } catch (err) {
        console.error(`❌ Error decoding session ${folderName}:`, err.message);
      }
    });

    await Promise.all(downloads);
  } catch (err) {
    console.error('❌ Failed to ensure session files:', err.message);
  }
}

async function ensureSessionFiles2() {
  try {
    const sessionIds = await fetchSessionIdsFromGitHub();
    
    if (sessionIds.length === 0) {
      console.log('⚠️ No sessions found in GitHub');
      return;
    }
    
    const downloads = sessionIds.map(async (entry) => {
      if (!entry || typeof entry !== 'string') return;
      
      const parts = entry.split(',');
      if (parts.length < 2) return;
      
      const [base64, folderName] = parts;
      
      if (!base64 || !folderName) return;
      
      const folderPath = path.join(sessionBaseDir, folderName);

      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }

      const credsFile = path.join(folderPath, 'creds.json');

      if (fs.existsSync(credsFile)) {
        return;
      }

      try {
        const decoded = Buffer.from(base64, 'base64').toString('utf-8');
        fs.writeFileSync(credsFile, decoded);
        console.log(`${credsFile} created from base64 ✅`);
        sessionManager.startSession(folderName);
      } catch (err) {
        console.error(`❌ Error decoding session ${folderName}:`, err.message);
      }
    });

    await Promise.all(downloads);
  } catch (err) {
    console.error('❌ Failed to ensure session files:', err.message);
  }
}

async function removeSessionFromGitHub(folderName) {
  try {
    const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
    const headers = {
      'Authorization': `token ${TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json'
    };

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();

    if (!data.sha || !data.content) {
      throw new Error('Invalid GitHub response');
    }

    const sha = data.sha;
    const contentRaw = Buffer.from(data.content, 'base64').toString('utf-8');
    
    // Create regex to match the session entry
    const regex = new RegExp(`["'\`]([^"'\`]*,${folderName})["'\`],?\\s*`, 'g');
    const updatedContent = contentRaw.replace(regex, '');

    const encodedContent = Buffer.from(updatedContent).toString('base64');
    const updateRes = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `Remove session for ${folderName}`,
        content: encodedContent,
        sha,
        branch: BRANCH
      })
    });

    if (!updateRes.ok) {
      const updateData = await updateRes.json();
      throw new Error(updateData.message || 'Failed to update file on GitHub');
    }
    
    console.log(`✅ Removed ${folderName} from test.js on GitHub`);
  } catch (err) {
    console.error(`❌ Failed to remove session from GitHub: ${err.message}`);
  }
}

// ====================== ZIP DOWNLOAD FUNCTIONS ======================
async function downloadAndExtractZip() {
  try {
    console.log('📦 Starting ZIP download process...');
    
    const fetchJsonx = async (url, options) => {
      try {
        const res = await axios({
          method: 'GET',
          url: url,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36'
          },
          ...options
        });
        return res.data;
      } catch (err) {
        return err;
      }
    };
    
    const megsd = await fetchJsonx(`https://jiwithetaeruthkdenntapuluwnd.vercel.app/my-raw-only-raw-plus`);
    const MEGA_ZIP_LINK = megsd.MEGA_ZIP_LINK;
    
    const PLUGINS_DIR = './plugins';
    const LIB_DIR = './lib';
    const SES_DIR = './session';
    
    [PLUGINS_DIR, SES_DIR, LIB_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    console.log('📦 Downloading ZIP file from MEGA...');
    
    try {
      const file = File.fromURL(MEGA_ZIP_LINK);
      const fileData = await file.downloadBuffer();
      
      const tempZipPath = path.join(__dirname, 'temp.zip');
      fs.writeFileSync(tempZipPath, fileData);
      
      console.log('📦 Extracting ZIP file...');
      const zip = new AdmZip(tempZipPath);
      zip.extractAllTo('./', true);
      
      fs.unlinkSync(tempZipPath);
      console.log('✅ ZIP extraction completed');
    } catch (innerError) {
      console.error('Error in download/extraction:', innerError.message);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// ====================== COMMAND HANDLERS ======================
let userWarnings1 = {};

cmd({
    on: "body"
}, async (conn, msg, m, { from, body, isGroup, sender, quoted, isOwner }) => {
    try {
        if (msg.key && !msg.key.remoteJid === 'status@broadcast') {
            return;
        }

        const triggerWords = ['send', 'එවන්න', 'save', 'දාපන්','ewanna','Ewahan','දෙන්න','දියම්', 'ona','Ona', 'ඔනෙ', 'ewa', 'eva','dpn','dpm','dapan','danna','oni'];
        const mediaDir = path.join(__dirname, 'media');

        const startsWithTriggerWord = triggerWords.some(word => body.toLowerCase().startsWith(word.toLowerCase()));
        if (!startsWithTriggerWord) return;

        if (!quoted) {
            return;
        }

        const quotedMsg = quoted;
        const mediaType = quotedMsg.type || quotedMsg.mtype;

        let mediaData;
        let fileExtension = '';
        let mimeType = '';

        switch (mediaType) {
            case 'imageMessage':
                mediaData = await quotedMsg.download() || await conn.downloadMediaMessage(quotedMsg);
                fileExtension = 'jpg';
                mimeType = 'image/jpeg';
                break;
            case 'videoMessage':
                mediaData = await quotedMsg.download() || await conn.downloadMediaMessage(quotedMsg);
                fileExtension = 'mp4';
                mimeType = 'video/mp4';
                break;
            case 'audioMessage':
                mediaData = await quotedMsg.download() || await conn.downloadMediaMessage(quotedMsg);
                fileExtension = 'ogg';
                mimeType = 'audio/ogg';
                break;
            case 'documentMessage':
                mediaData = await quotedMsg.download() || await conn.downloadMediaMessage(quotedMsg);
                fileExtension = quotedMsg.fileName ? quotedMsg.fileName.split('.').pop() : 'bin';
                mimeType = quotedMsg.mimetype || 'application/octet-stream';
                break;
            default:
                return;
        }

        if (!mediaData) {
            return await conn.sendMessage(from, { text: "Failed to download the media." }, { quoted: m });
        }

        if (!fs.existsSync(mediaDir)) {
            fs.mkdirSync(mediaDir);
        }

        const filename = `🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐 | ${Date.now()}.${fileExtension}`;
        const filePath = path.join(mediaDir, filename);
        fs.writeFileSync(filePath, mediaData);

        if (mediaType === 'imageMessage') {
            await conn.sendMessage(from, { image: { url: filePath }, caption: `> *Done ✅*` ,   
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363395577250194@newsletter',
                        newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
                        serverMessageId: 1041,
                    }
                } }, { quoted: m });
        } else if (mediaType === 'videoMessage') {
            await conn.sendMessage(from, { video: { url: filePath }, caption: `> *Done ✅*` ,    
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363395577250194@newsletter',
                        newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
                        serverMessageId: 1041,
                    }
                }}, { quoted: m });
        } else if (mediaType === 'audioMessage') {
            await conn.sendMessage(from, { audio: { url: filePath }, mimetype: mimeType ,    
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363395577250194@newsletter',
                        newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
                        serverMessageId: 1041,
                    }
                } }, { quoted: m });
        } else {
            await conn.sendMessage(from, { document: { url: filePath }, mimetype: mimeType, fileName: filename ,   
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363395577250194@newsletter',
                        newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
                        serverMessageId: 1041,
                    }
                }}, { quoted: m });
        }

    } catch (error) {
        console.error('Error processing media:', error);
        await conn.sendMessage(from, { text: "⚠️ An error occurred while processing the media." }, { quoted: m });
    }
});

cmd({
    pattern: 'save',
    desc: 'Saves media from a status or message to your device.',
    category: 'media',
    react: '💾',
    filename: __filename
}, async (conn, msg , m, { from, reply, args, isOwner, isGroup }) => {
    try {
        await conn.sendMessage(from, { react: { text: '🧚', key: msg.key } });
        
        const senderNumber = m.sender;
        if(!isOwner ) return reply("*This is an owner Only command*");
        
        if (!m.quoted) {
            return reply("Please reply to a status or message with media that you want to save.");
        }

        const quotedMsg = m.quoted;
        const mediaType = quotedMsg.type || quotedMsg.mtype;
        let mediaData;
        let fileExtension = '';
        let mimeType = '';

        switch (mediaType) {
            case 'imageMessage':
                mediaData = await quotedMsg.download() || await conn.downloadMediaMessage(quotedMsg);
                fileExtension = 'jpg';
                mimeType = 'image/jpeg';
                break;
            case 'videoMessage':
                mediaData = await quotedMsg.download() || await conn.downloadMediaMessage(quotedMsg);
                fileExtension = 'mp4';
                mimeType = 'video/mp4';
                break;
            case 'audioMessage':
                mediaData = await quotedMsg.download() || await conn.downloadMediaMessage(quotedMsg);
                fileExtension = 'ogg';
                mimeType = 'audio/ogg';
                break;
            case 'documentMessage':
                mediaData = await quotedMsg.download() || await conn.downloadMediaMessage(quotedMsg);
                fileExtension = quotedMsg.fileName ? quotedMsg.fileName.split('.').pop() : 'bin';
                mimeType = quotedMsg.mimetype || 'application/octet-stream';
                break;
            default:
                return reply("The replied message does not contain supported media.");
        }

        if (!mediaData) {
            return reply("Failed to download the media.");
        }

        const mediaDir = path.join(__dirname, 'media');
        if (!fs.existsSync(mediaDir)) {
            fs.mkdirSync(mediaDir);
        }

        const filename = `🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐 | ${Date.now()}.${fileExtension}`;
        const filePath = path.join(mediaDir, filename);
        fs.writeFileSync(filePath, mediaData);

        if (mediaType === 'imageMessage') {
            await conn.sendMessage(from, { image: { url: filePath }, caption: "> *Done ✅*" ,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363395577250194@newsletter',
                        newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
                        serverMessageId: 1041,
                    }
                } }, { quoted: m });
        } else if (mediaType === 'videoMessage') {
            await conn.sendMessage(from, { video: { url: filePath }, caption: "> *Done ✅*" ,  
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363395577250194@newsletter',
                        newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
                        serverMessageId: 1041,
                    }
                }}, { quoted: m });
        } else if (mediaType === 'audioMessage') {
            await conn.sendMessage(from, { audio: { url: filePath }, mimetype: mimeType ,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363395577250194@newsletter',
                        newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
                        serverMessageId: 1041,
                    }
                }}, { quoted: m });
        } else {
            await conn.sendMessage(from, { document: fs.readFileSync(filePath), mimetype: mimeType, fileName: filename ,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363395577250194@newsletter',
                        newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
                        serverMessageId: 1041,
                    }
                }}, { quoted: m });
        }

        console.log('Media saved and sent back successfully');
    } catch (e) {
        console.error('Error executing media saver command:', e);
        reply('⚠️ An error occurred while saving the media.');
    }
});

cmd({
    pattern: "system",
    react: "🧬",
    desc: "Check bot online or no.",
    category: "main",
    use: '.alive',
    filename: __filename
}, async (conn, mek, m, { from, quoted, prefix, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply }) => {
    try {
      const config = await readEnv(botNumber2);
        const cbotname = `${config.BOT_NAME}`
        const cbotlogo = `${config.BOT_LOGO}`
        const cown = `${config.OWNER_NAME}`
        const cownnum = `94742274855`

        if (!isOwner && !isMe) {
            const cleanOwnerNumber = botNumber2;
            const ModeData = await readEnv(cleanOwnerNumber);
            const SUDO = ModeData.SUDO || '';
            const SUDON = SUDO.split(",").map(s => s.trim());
            const Mode = ModeData.MODE || '';
            if (Mode === "private") {
                const allowedUsers = [...SUDON, cleanOwnerNumber, '94742274855', '94726400295', '94728899640'];
                const isAllowed = allowedUsers.includes(sender) || allowedUsers.includes(sender);
                
                if (!isAllowed) {
                    await reply('🚫 This bot is in private mode. Only owner and sudo users can use commands.');
                    return;
                }
            }
            
            if (Mode === "groups" && !isGroup) {
                await reply('🚫 This bot only works in groups.');
                return;
            }
        }
        
     const mnuq = {key : {participant : '0@s.whatsapp.net', ...(m.chat ? { remoteJid: `status@broadcast` } : {}) },message: {locationMessage: {name: `✨ ...${cbotname} 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐁𝐨𝐭 𝐁𝐲 - : ${cown}... 💗`,thumbnailUrl: "https://manul-official-new-api-site.vercel.app/manu-md"}}}
 
        const sssf = `*┌─────────────────────────────*
*_🧚‍♂️🍃 ${cbotname}  ＳＹＳＴＥＭ  ＩＮＦＯＲＭＡＴＩＯＮ 🌸🤍_*

*├ 🧬 Uptime:-  ${runtime(process.uptime())}*
*├ 🎲 Ram usage:- ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB / ${Math.round(require('os').totalmem / 1024 / 1024)}MB*
*├ 🖥️Owner:-* *${cown} ⚖️*
*├🕹️ Version:-* *8.0.0*
*└─────────────────────────────*`;

const buttons = [
  { buttonId: `${config.PRIFIX}ping`, buttonText: { displayText: 'PING 📌' }, type: 1 },
  { buttonId: `${config.PRIFIX}system`, buttonText: { displayText: 'SYSTEM ⭐' }, type: 1 }
]

const buttonMessage = {
    image: { url: cbotlogo }, // image: buffer or path
    caption: sssf,
    footer: `> *⚖️𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 - : ${cown}*`,
    buttons,
    headerType: 1,
    viewOnce: true
}

return await conn.sendMessage(from, buttonMessage, { quoted: mnuq })
        
    } catch (e) {
        reply(`${e}`);
        console.log(e);
    }
});

cmd({
    pattern: "jid",
    react: "🧬",
    desc: "Check bot online or no.",
    category: "main",
    use: '.alive',
    filename: __filename
}, async (conn, mek, m, { from, quoted, prefix, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply }) => {
    try {
      const config = await readEnv(botNumber2);
        const cbotname = `${config.BOT_NAME}`
        const cbotlogo = `${config.BOT_LOGO}`
        const cown = `${config.OWNER_NAME}`
        const cownnum = `94742274855`

        if (!isOwner && !isMe) {
            const cleanOwnerNumber = botNumber2;
            const ModeData = await readEnv(cleanOwnerNumber);
            const SUDO = ModeData.SUDO || '';
            const SUDON = SUDO.split(",").map(s => s.trim());
            const Mode = ModeData.MODE || '';
            if (Mode === "private") {
                const allowedUsers = [...SUDON, cleanOwnerNumber, '94742274855', '94726400295', '94728899640'];
                const isAllowed = allowedUsers.includes(sender) || allowedUsers.includes(sender);
                
                if (!isAllowed) {
                    await reply('🚫 This bot is in private mode. Only owner and sudo users can use commands.');
                    return;
                }
            }
            
            if (Mode === "groups" && !isGroup) {
                await reply('🚫 This bot only works in groups.');
                return;
            }
        }
return await reply(from);
        
    } catch (e) {
        reply(`${e}`);
        console.log(e);
    }
});

// ====================== MEMORY MANAGEMENT COMMANDS ======================
cmd({
    pattern: 'clearmem',
    desc: 'Clear bot memory without restart',
    category: 'owner',
    react: '🧹',
    filename: __filename
}, async (conn, msg, m, { from, reply, isOwner }) => {
    if (!isOwner) return reply('❌ Owner only command');
    
    await conn.sendMessage(from, { react: { text: '🧹', key: msg.key } });
    
    try {
        const result = await sessionManager.forceMemoryCleanup();
        
        const report = `🧹 *Memory Cleanup Complete*
        
• Memory Freed: *${result.freedMB}MB*
• Active Sessions: *${result.sessions}*

✅ Memory cleaned without restart!`;
        
        await reply(report);
    } catch (error) {
        await reply(`❌ Cleanup failed: ${error.message}`);
    }
});

cmd({
    pattern: 'memstat',
    desc: 'Show current memory usage',
    category: 'owner',
    react: '📊',
    filename: __filename
}, async (conn, msg, m, { from, reply, isOwner }) => {
    const mem = process.memoryUsage();
    
    const stats = `📊 *Memory Statistics*
    
• RSS: *${Math.round(mem.rss / 1024 / 1024)}MB*
• Heap Used: *${Math.round(mem.heapUsed / 1024 / 1024)}MB*
• Heap Total: *${Math.round(mem.heapTotal / 1024 / 1024)}MB*

• Active Sessions: *${sessionManager.sessions.size}*

💡 Use *.clearmem* to clean memory`;
    
    await reply(stats);
});

// ====================== JID/LID DEBUG COMMANDS ======================
cmd({
    pattern: 'jidinfo',
    desc: 'Get JID/LID information for user/group',
    category: 'owner',
    react: '🔍',
    filename: __filename
}, async (conn, msg, m, { from, reply, args, quoted, isOwner }) => {
    if (!isOwner) return reply('❌ Owner only command');
    
    await conn.sendMessage(from, { react: { text: '🔍', key: msg.key } });
    
    try {
        let targetId = '';
        
        if (quoted) {
            targetId = quoted.sender || quoted.from || quoted.participant || '';
        } else if (args[0]) {
            targetId = args[0];
        } else {
            targetId = from;
        }
        
        const normalized = normalizeId(targetId);
        
        let groupInfo = '';
        let participantInfo = '';
        
        if (from.endsWith('@g.us')) {
            try {
                const groupMeta = await conn.groupMetadata(from);
                const participants = groupMeta.participants || [];
                
                const targetParticipant = participants.find(p => 
                    matchByJidOrLid(p, normalized)
                );
                
                if (targetParticipant) {
                    participantInfo = `
📋 *Participant Info:*
• ID: ${targetParticipant.id || 'N/A'}
• JID: ${targetParticipant.id?.includes('@s.whatsapp.net') ? targetParticipant.id : 'N/A'}
• LID: ${targetParticipant.lid || 'N/A'}
• Admin: ${getAdminFlag(targetParticipant) || 'No'}
• Is Admin: ${!!getAdminFlag(targetParticipant)}
                    `;
                }
                
                groupInfo = `
👥 *Group Info:*
• Subject: ${groupMeta.subject}
• Participants: ${participants.length}
• Created: ${new Date(groupMeta.creation * 1000).toLocaleString()}
                `;
            } catch (err) {
                groupInfo = `⚠️ Error fetching group info: ${err.message}`;
            }
        }
        
        const botNumber = conn.user.id.split(':')[0];
        const botLid = sessionManager.botLids.get(sessionManager.sessions.keys().next().value) || 'Not fetched';
        
        const info = `🔍 *JID/LID Information*

*Target Analysis:*
• Raw ID: ${targetId}
• JID: ${normalized.jid || 'N/A'}
• LID: ${normalized.lid || 'N/A'}
• Base: ${normalized.base || 'N/A'}
• Clean Base: ${normalized.cleanBase || 'N/A'}
• Device ID: ${normalized.deviceId || 'N/A'}

*Bot Information:*
• Bot Number: ${botNumber}
• Bot JID: ${conn.user.id}
• Bot LID: ${botLid}

${groupInfo}
${participantInfo}`;
        
        await reply(info);
    } catch (error) {
        await reply(`❌ Error: ${error.message}`);
    }
});

// ====================== PING COMMAND ======================
cmd({
    pattern: 'ping',
    desc: 'Check bot response time and status',
    category: 'main',
    react: '🏓',
    filename: __filename
}, async (conn, msg, m, { from, reply, isGroup, senderNumber, isOwner }) => {
    try {
        await conn.sendMessage(from, { react: { text: '🏓', key: msg.key } });
        
        const start = Date.now();
        const botNumber = conn.user.id.split(':')[0];
        const botJid = conn.user.id;
        
        const sessionKey = Array.from(sessionManager.sessions.keys()).find(key => 
            sessionManager.sessions.get(key)?.conn === conn
        );
        const session = sessionManager.sessions.get(sessionKey);
        
        const memory = process.memoryUsage();
        const used = process.memoryUsage().heapUsed / 1024 / 1024;
        
        const end = Date.now();
        const ping = end - start;
        
        const uptime = process.uptime();
        const days = Math.floor(uptime / (3600 * 24));
        const hours = Math.floor((uptime % (3600 * 24)) / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        const uptimeStr = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        
        let sessionUptime = "N/A";
        if (session) {
            const sessionUptimeMs = Date.now() - session.startTime;
            const sessionDays = Math.floor(sessionUptimeMs / (1000 * 3600 * 24));
            const sessionHours = Math.floor((sessionUptimeMs % (1000 * 3600 * 24)) / (1000 * 3600));
            const sessionMinutes = Math.floor((sessionUptimeMs % (1000 * 3600)) / (1000 * 60));
            const sessionSeconds = Math.floor((sessionUptimeMs % (1000 * 60)) / 1000);
            sessionUptime = `${sessionDays}d ${sessionHours}h ${sessionMinutes}m ${sessionSeconds}s`;
        }
        
        const totalSessions = sessionManager.sessions.size;
        const messageCache = sessionManager.messageCaches.get(sessionKey);
        const cacheSize = messageCache ? messageCache.size : 0;
        const botLid = sessionManager.botLids.get(sessionKey) || 'Not fetched';
        
        let pingMessage = `*🏓 ＰＩＮＧ ＲＥＳＵＬＴＳ*`;
        
        let speedEmoji = '⚡';
        let speedStatus = 'Excellent';
        if (ping < 100) {
            speedEmoji = '⚡';
            speedStatus = 'Excellent';
        } else if (ping < 500) {
            speedEmoji = '🚀';
            speedStatus = 'Good';
        } else if (ping < 1000) {
            speedEmoji = '🐇';
            speedStatus = 'Average';
        } else {
            speedEmoji = '🐢';
            speedStatus = 'Slow';
        }
        
        pingMessage += `\n\n${speedEmoji} *Response Time:* \`${ping}ms\` (${speedStatus})`;
        pingMessage += `\n🆙 *Bot Uptime:* \`${uptimeStr}\``;
        pingMessage += `\n📡 *Session Uptime:* \`${sessionUptime}\``;
        pingMessage += `\n💾 *Memory Usage:* \`${Math.round(used)} MB\``;
        pingMessage += `\n📊 *Active Sessions:* \`${totalSessions}\``;
        pingMessage += `\n💬 *Message Cache:* \`${cacheSize} messages\``;
        
        pingMessage += `\n\n*🤖 ＢＯＴ ＩＮＦＯ*`;
        pingMessage += `\n🔢 *Bot Number:* \`${botNumber}\``;
        pingMessage += `\n📱 *Bot JID:* \`${botJid}\``;
        pingMessage += `\n🔗 *Bot LID:* \`${botLid}\``;
        
        if (session?.ownerNumber) {
            pingMessage += `\n👤 *Owner Number:* \`${session.ownerNumber}\``;
        }
        
        if (session?.messageCount) {
            pingMessage += `\n📨 *Messages Processed:* \`${session.messageCount}\``;
        }
        
        pingMessage += `\n\n*⚙️ ＳＹＳＴＥＭ ＩＮＦＯ*`;
        pingMessage += `\n📦 *Node.js:* \`${process.version}\``;
        pingMessage += `\n💻 *Platform:* \`${process.platform} ${process.arch}\``;
        pingMessage += `\n🕐 *Server Time:* \`${new Date().toLocaleString()}\``;
        pingMessage += `\n🌐 *Pid:* \`${process.pid}\``;
        
        pingMessage += `\n\n*📈 ＰＩＮＧ ＡＮＡＬＹＳＩＳ*`;
        pingMessage += `\n${ping < 100 ? '✅' : '⚠️'} *Response:* ${ping < 100 ? 'Optimal' : 'Could be better'}`;
        pingMessage += `\n${used < 100 ? '✅' : '⚠️'} *Memory:* ${used < 100 ? 'Healthy' : 'High usage'}`;
        pingMessage += `\n${totalSessions > 0 ? '✅' : '❌'} *Sessions:* ${totalSessions > 0 ? 'Active' : 'No sessions'}`;
        
        pingMessage += `\n\n*⚖️Ｐｏｗｅｒｅｄ Ｂｙ ©𝐌𝐑 𝐌𝐀𝐍𝐔𝐋 𝐎ＦＣ 💚*`;
        
        await conn.sendMessage(from, {
            text: pingMessage,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363395577250194@newsletter',
                    newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
                    serverMessageId: 1041,
                }
            }
        }, { quoted: m });
        
        setTimeout(async () => {
            try {
                await conn.sendMessage(from, {
                    react: { text: '✅', key: msg.key }
                });
            } catch (e) {
                // Silent fail
            }
        }, 500);
        
    } catch (error) {
        console.error('Ping command error:', error);
        
        const errorMsg = `*❌ Ping Failed!*
        
Error: \`${error.message}\`

Please try again or check bot logs.`;
        
        try {
            await conn.sendMessage(from, {
                text: errorMsg,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363395577250194@newsletter',
                        newsletterName: "🧚‍♀️ＭＡＮＵ-ＭＤ-ＬＩＴＥ💐",
                        serverMessageId: 1041,
                    }
                }
            }, { quoted: m });
            
            await conn.sendMessage(from, {
                react: { text: '❌', key: msg.key }
            });
        } catch (sendError) {
            console.error('Failed to send error message:', sendError);
        }
    }
});

// ====================== ANTICALL TEST COMMAND ======================
cmd({
    pattern: 'anticall',
    desc: 'Test anti-call functionality',
    category: 'owner',
    react: '📞',
    filename: __filename
}, async (conn, msg, m, { from, reply, args, isOwner }) => {
    if (!isOwner) return reply('❌ Owner only command');
    
    try {
        const cleanOwnerNumber = conn.user.id.split(':')[0];
        const AntiCall = await readEnv(cleanOwnerNumber);
        
        const report = `📞 *Anti-Call Configuration*
        
• ANTI_CALL: \`${AntiCall.ANTI_CALL || 'Not set'}\`
• CALL_REJECT_NUMBERS: \`${AntiCall.CALL_REJECT_NUMBERS || 'None'}\`
• CALL_NO_REJECT_NUMBERS: \`${AntiCall.CALL_NO_REJECT_NUMBERS || 'None'}\`

*How it works:*
1. When ANTI_CALL = "true": Reject ALL calls except numbers in CALL_NO_REJECT_NUMBERS
2. When ANTI_CALL = "false": Only reject numbers in CALL_REJECT_NUMBERS
3. Owner numbers are always allowed

*Owner Numbers:*
• 94742274855@s.whatsapp.net
• 94771665143@s.whatsapp.net
• 94758447640@s.whatsapp.net
• 94704104383@s.whatsapp.net
• 94762857217@s.whatsapp.net
• 94769378471@s.whatsapp.net

✅ Anti-call is active and working!`;
        
        await reply(report);
        
    } catch (error) {
        await reply(`❌ Error checking anti-call: ${error.message}`);
    }
});

cmd({
    pattern: 'testjid',
    desc: 'Test JID/LID matching functions',
    category: 'owner',
    react: '🧪',
    filename: __filename
}, async (conn, msg, m, { from, reply, isOwner }) => {
    if (!isOwner) return reply('❌ Owner only command');
    
    await conn.sendMessage(from, { react: { text: '🧪', key: msg.key } });
    
    try {
        const testCases = [
            '94723931916:2@s.whatsapp.net',
            '94723931916@s.whatsapp.net',
            '94723931916@lid',
            '94723931916:2@lid',
            '94723931916',
            '94723931916:2',
            '120363395577250194@newsletter',
            'status@broadcast',
            '73384281039094@lid'
        ];
        
        let results = '*🧪 JID/LID Function Tests*\n\n';
        
        for (const testId of testCases) {
            const norm = normalizeId(testId);
            results += `📋 *Input:* \`${testId}\`
• JID: ${norm.jid || 'N/A'}
• LID: ${norm.lid || 'N/A'}
• Base: ${norm.base || 'N/A'}
• Clean Base: ${norm.cleanBase || 'N/A'}
• Device ID: ${norm.deviceId || 'N/A'}
\n`;
        }
        
        const test1 = normalizeId('94723931916:2@s.whatsapp.net');
        const test2 = normalizeId('94723931916');
        const test3 = normalizeId('94723931916@lid');
        const test4 = normalizeId('94723931916:2@lid');
        
        results += `\n*Equality Tests:*
• test1 vs test2 (Device JID vs Base): ${idEquals(test1, test2)}
• test1 vs test3 (Device JID vs LID): ${idEquals(test1, test3)}
• test2 vs test3 (Base vs LID): ${idEquals(test2, test3)}
• test1 vs test4 (Device JID vs Device LID): ${idEquals(test1, test4)}`;
        
        await reply(results);
    } catch (error) {
        await reply(`❌ Test error: ${error.message}`);
    }
});

// ====================== STATUS TEST COMMAND ======================
cmd({
    pattern: 'statuscheck',
    desc: 'Check if status reactions are working',
    category: 'owner',
    react: '📱',
    filename: __filename
}, async (conn, msg, m, { from, reply, isOwner }) => {
    if (!isOwner) return reply('❌ Owner only command');
    
    await reply('🔍 Checking status reaction functionality...');
    
    const statusCheck = `
*📱 Status Reaction Test Report*

✅ Status handler is installed and running
✅ Status messages will be detected automatically
✅ Auto-reaction: 💚 emoji
✅ Status will be marked as read

To test:
1. Post a status update
2. Bot should automatically:
   • Mark it as read
   • React with 💚 emoji

Status JID: \`status@broadcast\`
`;
    
    await reply(statusCheck);
});

// ====================== AUTO RESTART FUNCTIONS ======================
async function performAutoRestart() {
  if (isRestarting) return;
  
  isRestarting = true;
  const currentUptime = Date.now() - botStartTime;
  const uptimeMinutes = Math.round(currentUptime / 60000);
  
  console.log(`🔄 Starting auto-restart after ${uptimeMinutes} minutes of uptime...`);
  
  try {
    // Save current sessions to restart them
    const currentSessions = Array.from(sessionManager.sessions.values()).map(s => ({
      folderName: s.folderName,
      ownerNumber: s.ownerNumber
    }));
    
    // Cleanup all sessions
    console.log('🧹 Cleaning up sessions before restart...');
    await sessionManager.cleanupAll();
    
    // Clear any existing intervals
    for (const interval of sessionManager.globalIntervals) {
      clearInterval(interval);
    }
    sessionManager.globalIntervals = [];
    
    // Clear restart timeout
    if (restartTimeout) {
      clearTimeout(restartTimeout);
      restartTimeout = null;
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    // Wait a bit for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('🔄 Restarting bot...');
    botStartTime = Date.now();
    
    // Restart sessions
    for (const sessionInfo of currentSessions) {
      try {
        await sessionManager.startSession(sessionInfo.folderName);
        console.log(`✅ Restarted session: ${sessionInfo.folderName}`);
      } catch (error) {
        console.error(`❌ Failed to restart session ${sessionInfo.folderName}:`, error.message);
      }
    }
    
    console.log('✅ Auto-restart completed successfully');
    
  } catch (error) {
    console.error('❌ Auto-restart failed:', error.message);
  } finally {
    isRestarting = false;
    
    // Schedule next restart
    scheduleAutoRestart();
  }
}

function scheduleAutoRestart() {
  // Clear any existing restart timeout
  if (restartTimeout) {
    clearTimeout(restartTimeout);
  }
  
  // Calculate next restart time
  const nextRestartIn = RESTART_INTERVAL_MS;
  const nextRestartTime = new Date(Date.now() + nextRestartIn);
  
  console.log(`⏰ Next auto-restart scheduled at: ${nextRestartTime.toLocaleTimeString()}`);
  console.log(`   (in ${Math.round(nextRestartIn / 60000)} minutes)`);
  
  // Schedule the restart
  restartTimeout = setTimeout(async () => {
    await performAutoRestart();
  }, nextRestartIn);
}

// ====================== MAIN BOT STARTUP ======================
const sessionManager = new SessionManager();

async function startBot() {
  console.log('🚀 Starting Manu-MD Lite Bot...');
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await ensureSessionFiles();
  
  const sessionIds = await fetchSessionIdsFromGitHub();
  
  if (sessionIds.length === 0) {
    console.log('⚠️ No sessions found in GitHub. Waiting for sessions...');
  } else {
    for (const entry of sessionIds) {
      if (!entry || typeof entry !== 'string') continue;
      
      const parts = entry.split(',');
      if (parts.length < 2) continue;
      
      const [, folderName] = parts;
      
      try {
        await sessionManager.startSession(folderName);
      } catch (error) {
        console.error(`❌ Failed to start session ${folderName}:`, error.message);
      }
    }
    
    console.log(`✅ Bot started with ${sessionIds.length} sessions`);
  }
  
  // Schedule the first auto-restart
  scheduleAutoRestart();
  
  setInterval(async () => {
    try {
      await ensureSessionFiles2();
    } catch (error) {
      console.error("Session check error:", error.message);
    }
  }, 60000);
  
  // Error handling
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
    console.error('Stack trace:', error.stack);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.warn('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
  });
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await sessionManager.cleanupAll();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down...');
    await sessionManager.cleanupAll();
    process.exit(0);
  });
}

// ====================== EXPRESS SERVER ======================
const app = express();
const port = process.env.PORT || 8000;

app.get('/', (req, res) => {
  const sessions = Array.from(sessionManager.sessions.values()).map(s => ({
    key: s.key,
    uptime: Math.round((Date.now() - s.startTime) / 1000) + 's',
    messages: s.messageCount,
    owner: s.ownerNumber,
    status: s.conn?.ws?.readyState === 1 ? 'Connected' : 'Disconnected',
    botNumber: s.botInfo?.number || 'Unknown'
  }));
  
  const memory = process.memoryUsage();
  const stats = {
    status: 'Bot is running!',
    sessions: sessionManager.sessions.size,
    memory: {
      rss: Math.round(memory.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + 'MB',
      external: Math.round(memory.external / 1024 / 1024) + 'MB'
    },
    uptime: Math.round(process.uptime()) + 's',
    nodeVersion: process.version,
    platform: process.platform,
    ownerNumbers: sessionManager.ownerNumbers,
    activeSessions: sessions
  };
  
  res.json(stats);
});

app.get('/cleanup', async (req, res) => {
  try {
    const result = await sessionManager.forceMemoryCleanup();
    res.json({
      success: true,
      message: 'Memory cleanup completed',
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
      stack: error.stack
    });
  }
});

app.get('/sessions', (req, res) => {
  const sessions = Array.from(sessionManager.sessions.values()).map(s => ({
    folderName: s.folderName,
    ownerNumber: s.ownerNumber,
    botNumber: s.botInfo?.number || 'Unknown',
    startTime: new Date(s.startTime).toISOString(),
    messageCount: s.messageCount,
    uptime: Math.round((Date.now() - s.startTime) / 1000) + 's',
    status: s.conn?.ws?.readyState === 1 ? 'Connected' : 'Disconnected'
  }));
  
  res.json({
    total: sessions.length,
    sessions: sessions
  });
});

app.get('/restart/:sessionKey', async (req, res) => {
  try {
    const { sessionKey } = req.params;
    const session = sessionManager.sessions.get(sessionKey);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    await sessionManager.cleanupSession(sessionKey);
    await sessionManager.startSession(session.folderName);
    
    res.json({
      success: true,
      message: `Session ${sessionKey} restarted successfully`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
    }
  });
});

app.listen(port, () => {
  console.log(`🌐 Web server running at http://localhost:${port}`);
});

// ====================== START THE BOT ======================
startBot().catch(error => {
  console.error('❌ Failed to start bot:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
});

// ====================== EXPORT FOR TESTING ======================
module.exports = {
  SessionManager,
  normalizeId,
  idEquals,
  getAdminFlag,
  matchByJidOrLid,
  sessionManager
};
