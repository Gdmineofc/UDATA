const fs = require('fs-extra');
const path = require('path');
const { MongoClient } = require('mongodb');

// Configuration
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://manulmihisara9_db_user:ym41ZGDc1l2FGYZs@my.oc6wyc2.mongodb.net/';
const DATABASE_NAME = 'MANUDB';
const COLLECTION_NAME = 'SETTINGS';

// Connection state
let mongoClient = null;
let isMongoConnected = false;
let mongoConnectionAttempted = false;
let syncQueue = new Map();
let syncTimer = null;

// Default settings
const defaults = {
  BOT_NAME: "ＭＡＮＵ-ＭＤ",
  OWNER_NUMBER: "94742274855",
  OWNER_NAME: "©𝐌𝐑 𝐌𝐀𝐍𝐔𝐋 𝐎ｍＣ 💚",
  OWNER_FROM: "Sri Lanka",
  BUTTON: "true",
  OWNER_AGE: "+99",
  PRIFIX: ".",
  MODE: "private",
  MANU_LAN: "EN",
  MOVIE_JIDS: "",
  AUTO_REACT: "false",
  ANTI_DELETE: "owner",
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
  BOT_LOGO: "https://my-private-api-site.vercel.app/manu-md",
  OWNER_IMG: "https://my-private-api-site.vercel.app/manu-md",
  MENU_LOGO: "https://my-private-api-site.vercel.app/manu-md",
  ALIVE_LOGO: "https://my-private-api-site.vercel.app/manu-md",
  ALIVE_MSG: "⚖️𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 - : ©𝐌𝐑 𝐌𝐀𝐍𝐔𝐋 𝐎ｍＣ 💚",
  AUTO_DP_CHANGE: "false",
  AUTO_DP: "",
  BAN: "",
  SUDO: "",
  AUTO_CHANNEL_SONG: "false",
  XNX_VIDEO: "false",
  CHANNEL_JID: "",
  _source: 'json', // Track where settings came from
  _createdAt: Date.now()
};

// Simple in-memory cache with TTL
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
  // Remove 'creds.json' suffix and non-numeric characters
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

// Initialize MongoDB connection (ONLY when needed)
async function initializeMongoDB() {
  if (mongoConnectionAttempted) return mongoClient;
  
  mongoConnectionAttempted = true;
  
  try {
    console.log('🔄 Attempting MongoDB connection...');
    
    mongoClient = new MongoClient(MONGO_URI, {
      maxPoolSize: 50,
      minPoolSize: 5,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 15000,
      retryWrites: true,
      retryReads: true,
      ssl: true,
      tls: true,
      tlsAllowInvalidCertificates: false,
      family: 4,
      maxConnecting: 10,
      compressors: ['snappy', 'zlib']
    });
    
    await mongoClient.connect();
    
    // Test connection with a simple command
    await mongoClient.db(DATABASE_NAME).command({ ping: 1 });
    
    isMongoConnected = true;
    console.log('✅ MongoDB connected successfully');
    
    // Start batch sync timer only if we have pending syncs
    if (!syncTimer) {
      syncTimer = setInterval(async () => {
        if (syncQueue.size > 0) {
          await syncBatchToMongoDB();
        }
      }, 60000); // Check every minute
    }
    
    return mongoClient;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    isMongoConnected = false;
    mongoClient = null;
    return null;
  }
}

// Get MongoDB client (lazy initialization)
async function getMongoClient() {
  if (!isMongoConnected) {
    await initializeMongoDB();
  }
  return mongoClient;
}

// JSON file operations
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
    
    // Remove internal metadata before saving
    const { _source, _lastLoaded, _lastUpdated, _isTemp, ...cleanSettings } = settings;
    
    await fs.writeJson(filePath, cleanSettings, { spaces: 2 });
    return true;
  } catch (error) {
    console.error(`❌ Error saving JSON for ${cleanNumber}:`, error.message);
    return false;
  }
}

// Load or create settings - JSON FIRST, MongoDB ONLY when updating
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
  
  // 2. ALWAYS try JSON file first (primary source)
  const jsonSettings = await loadFromJSON(cleanNumber);
  if (jsonSettings) {
    settingsCache.set(cleanNumber, jsonSettings);
    return jsonSettings;
  }
  
  // 3. If JSON doesn't exist, create TEMPORARY defaults
  // DO NOT create MongoDB document here!
  const tempSettings = {
    ownerNumber: cleanNumber,
    ...defaults,
    _source: 'temp',
    _isTemp: true,
    _createdAt: Date.now()
  };
  
  // Save temp settings to JSON
  await saveToJSON(cleanNumber, tempSettings);
  
  // Cache temp settings
  settingsCache.set(cleanNumber, tempSettings);
  
  console.log(`✅ Created temp settings for ${cleanNumber} (JSON only)`);
  return tempSettings;
}

// Alias for loadSettings
async function readEnv(ownerNumber) {
  return await loadSettings(ownerNumber);
}

// Initialize/ensure settings exist (creates JSON only)
async function defEnv(ownerNumber) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber) return false;
  
  try {
    const settings = await loadSettings(cleanNumber);
    return !settings._isTemp; // Returns true if settings already existed
  } catch (error) {
    console.error(`❌ Error in defEnv for ${cleanNumber}:`, error.message);
    return false;
  }
}

// Batch sync to MongoDB (only for settings that are NOT temp)
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
      // Skip temp settings - they don't go to MongoDB
      if (settings._isTemp) {
        syncQueue.delete(ownerNumber);
        continue;
      }
      
      // Remove internal metadata
      const { _source, _lastLoaded, _lastUpdated, _isTemp, ...cleanSettings } = settings;
      
      operations.push({
        updateOne: {
          filter: { ownerNumber },
          update: {
            $set: {
              ...cleanSettings,
              _lastSynced: now,
              _updatedAt: now
            },
            $setOnInsert: { _createdAt: now }
          },
          upsert: true
        }
      });
      
      syncQueue.delete(ownerNumber);
    }
    
    if (operations.length > 0) {
      await collection.bulkWrite(operations, { ordered: false });
      console.log(`✅ Batch synced ${operations.length} settings to MongoDB`);
    }
  } catch (error) {
    console.error('❌ Batch sync failed:', error.message);
    // Keep items in queue for retry
  }
}

// Update settings - this is where MongoDB comes into play
async function updateEnv(ownerNumber, key, newValue) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber || !key) {
    console.error('❌ Invalid parameters for update');
    return false;
  }
  
  try {
    // Get current settings
    const currentSettings = await loadSettings(cleanNumber);
    const wasTemp = currentSettings._isTemp;
    
    // Special handling for AUTO_DP
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
    
    // Create updated settings
    const updatedSettings = {
      ...currentSettings,
      [key]: updatedValue,
      _lastUpdated: Date.now(),
      _isTemp: false // Mark as permanent once updated
    };
    
    // Update cache
    settingsCache.set(cleanNumber, updatedSettings);
    
    // ALWAYS save to JSON immediately
    await saveToJSON(cleanNumber, updatedSettings);
    
    // If settings were temp and this is the first update, initialize MongoDB
    if (wasTemp && !isMongoConnected) {
      await initializeMongoDB();
    }
    
    // Queue for MongoDB sync if connected
    if (isMongoConnected) {
      syncQueue.set(cleanNumber, updatedSettings);
      
      // If this was a temp setting being saved for first time, sync immediately
      if (wasTemp) {
        setTimeout(() => syncBatchToMongoDB(), 1000);
      }
    }
    
    console.log(`✅ Updated "${key}" for ${cleanNumber}${wasTemp ? ' (first save to MongoDB)' : ''}`);
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
    
    // Convert values to array
    let valuesArray = [];
    if (Array.isArray(values)) {
      valuesArray = values;
    } else if (typeof values === 'string') {
      valuesArray = values.split(',').map(v => v.trim()).filter(v => v !== '');
    } else {
      return false;
    }
    
    // Get current array
    const currentValue = currentSettings[key] || "";
    let currentArray = currentValue.split(',').map(v => v.trim()).filter(v => v !== '');
    
    // Update array
    if (action === "add") {
      const combinedSet = new Set([...currentArray, ...valuesArray]);
      currentArray = Array.from(combinedSet);
    } else if (action === "remove") {
      currentArray = currentArray.filter(v => !valuesArray.includes(v));
    } else {
      return false;
    }
    
    // Update setting
    const newValue = currentArray.join(',');
    return await updateEnv(cleanNumber, key, newValue);
    
  } catch (error) {
    console.error(`❌ Error updating list ${key} for ${cleanNumber}:`, error.message);
    return false;
  }
}

// Auto DP change
async function dpchange(conn, jid, url) {
  if (!conn || !jid || !url) return;
  
  try {
    const settings = await readEnv(jid);
    
    if (settings.AUTO_DP_CHANGE !== 'true') return;
    
    // Add delay based on last digit
    const lastDigit = parseInt(jid.slice(-1), 10) || 0;
    const delay = (lastDigit + 1) * 1000;
    
    await new Promise(resolve => setTimeout(resolve, delay));
    await conn.updateProfilePicture(`${jid}@s.whatsapp.net`, { url: url });
    
  } catch (error) {
    console.error(`❌ DP change failed for ${jid}:`, error.message);
  }
}

// Force sync to MongoDB
async function forceSyncToMongoDB(ownerNumber) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber || !isMongoConnected) return false;
  
  try {
    const settings = await loadSettings(cleanNumber);
    
    // Don't sync temp settings
    if (settings._isTemp) {
      console.log(`⚠️ Skipping sync for ${cleanNumber} (temp settings)`);
      return false;
    }
    
    const client = await getMongoClient();
    const db = client.db(DATABASE_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    // Remove internal metadata
    const { _source, _lastLoaded, _lastUpdated, _isTemp, ...cleanSettings } = settings;
    
    await collection.updateOne(
      { ownerNumber: cleanNumber },
      { 
        $set: {
          ...cleanSettings,
          _lastSynced: Date.now(),
          _updatedAt: Date.now()
        },
        $setOnInsert: { _createdAt: Date.now() }
      },
      { upsert: true }
    );
    
    // Remove from queue
    syncQueue.delete(cleanNumber);
    
    console.log(`✅ Force synced to MongoDB: ${cleanNumber}`);
    return true;
  } catch (error) {
    console.error(`❌ Force sync failed for ${cleanNumber}:`, error.message);
    return false;
  }
}

// Get all settings for debugging
async function getAllSettings(ownerNumber) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  
  const result = {
    cache: settingsCache.get(cleanNumber),
    json: await loadFromJSON(cleanNumber),
    mongo: null
  };
  
  // Try MongoDB if connected
  if (isMongoConnected) {
    try {
      const client = await getMongoClient();
      const db = client.db(DATABASE_NAME);
      const collection = db.collection(COLLECTION_NAME);
      
      result.mongo = await collection.findOne({ ownerNumber: cleanNumber });
    } catch (error) {
      // Silent fail - MongoDB might not be available
    }
  }
  
  return result;
}

// Get sync queue status
function getSyncQueueStatus() {
  return {
    queueSize: syncQueue.size,
    isMongoConnected,
    cacheSize: settingsCache.size,
    mongoConnectionAttempted
  };
}

// Close connections gracefully
async function closeConnection() {
  console.log('🔄 Closing connections...');
  
  // Sync any remaining items
  if (syncQueue.size > 0 && isMongoConnected) {
    console.log(`Syncing ${syncQueue.size} remaining items...`);
    await syncBatchToMongoDB();
  }
  
  // Clear timer
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  
  // Close MongoDB
  if (mongoClient) {
    try {
      await mongoClient.close();
      console.log('✅ MongoDB connection closed');
    } catch (error) {
      console.error('❌ Error closing MongoDB:', error.message);
    }
    mongoClient = null;
    isMongoConnected = false;
  }
  
  // Clear cache
  settingsCache.clear();
  syncQueue.clear();
}

// Initialize on module load
(async () => {
  await ensureSettingsDir();
  console.log('✅ Settings manager initialized (JSON mode)');
  
  // Don't auto-connect to MongoDB - lazy initialization
})();

// Handle process cleanup
process.on('SIGINT', closeConnection);
process.on('SIGTERM', closeConnection);
process.on('beforeExit', closeConnection);

module.exports = {
  // Core functions
  readEnv,
  defEnv,
  updateEnv,
  updateList,
  loadSettings,
  dpchange,
  
  // Management functions
  closeConnection,
  forceSyncToMongoDB,
  getAllSettings,
  getSyncQueueStatus,
  initializeMongoDB,
  
  // Utility functions
  cleanOwnerNumber,
  loadFromJSON,
  saveToJSON,
  
  // Status
  get isMongoConnected() {
    return isMongoConnected;
  },
  
  get cacheSize() {
    return settingsCache.size;
  }
};
