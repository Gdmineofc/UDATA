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
  OWNER_NAME: "©𝐌𝐑 𝐌𝐀𝐍ＵＬ 𝐎ｍＣ 💚",
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
  ALIVE_MSG: "⚖️𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 - : ©𝐌𝐑 𝐌𝐀𝐍ＵＬ 𝐎ｍＣ 💚",
  AUTO_DP_CHANGE: "false",
  AUTO_DP: "",
  BAN: "",
  SUDO: "",
  AUTO_CHANNEL_SONG: "false",
  XNX_VIDEO: "false",
  CHANNEL_JID: "",
  _source: 'json'
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

// Initialize MongoDB connection
async function initializeMongoDB() {
  if (mongoConnectionAttempted && !isMongoConnected) return null;
  
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
      family: 4,
    });
    
    await mongoClient.connect();
    
    // Test connection
    await mongoClient.db(DATABASE_NAME).command({ ping: 1 });
    
    isMongoConnected = true;
    console.log('✅ MongoDB connected successfully');
    
    // Start batch sync timer
    if (!syncTimer) {
      syncTimer = setInterval(async () => {
        if (syncQueue.size > 0) {
          await syncBatchToMongoDB();
        }
      }, 60000);
    }
    
    return mongoClient;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    isMongoConnected = false;
    mongoClient = null;
    return null;
  }
}

// Get MongoDB client
async function getMongoClient() {
  if (!isMongoConnected) {
    return await initializeMongoDB();
  }
  return mongoClient;
}

// Check if document exists in MongoDB
async function checkMongoDBExists(ownerNumber) {
  const cleanNumber = cleanOwnerNumber(ownerNumber);
  if (!cleanNumber || !isMongoConnected) return null;
  
  try {
    const client = await getMongoClient();
    if (!client) return null;
    
    const db = client.db(DATABASE_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const existingDoc = await collection.findOne({ ownerNumber: cleanNumber });
    return existingDoc;
  } catch (error) {
    console.error(`❌ Error checking MongoDB for ${cleanNumber}:`, error.message);
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
    
    // Convert MongoDB document to settings format
    const settings = {
      ownerNumber: cleanNumber,
      ...defaults,
      ...existingDoc,
      _source: 'mongo',
      _lastLoaded: Date.now(),
      _isTemp: true  // Still temp until updated
    };
    
    // Remove MongoDB _id field
    delete settings._id;
    
    // Save to JSON file
    await saveToJSON(cleanNumber, settings);
    
    console.log(`✅ Loaded existing settings from MongoDB for ${cleanNumber}`);
    return settings;
  } catch (error) {
    console.error(`❌ Error loading from MongoDB for ${cleanNumber}:`, error.message);
    return null;
  }
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

// Load or create settings - Check MongoDB first if exists, otherwise defaults
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
  
  // 3. JSON doesn't exist - Initialize MongoDB connection
  if (!isMongoConnected && !mongoConnectionAttempted) {
    await initializeMongoDB();
  }
  
  // 4. Check if document exists in MongoDB
  let settings = null;
  
  if (isMongoConnected) {
    // Try to load from MongoDB
    settings = await loadFromMongoDB(cleanNumber);
  }
  
  // 5. If no MongoDB document exists, create TEMPORARY defaults
  if (!settings) {
    settings = {
      ownerNumber: cleanNumber,
      ...defaults,
      _source: 'temp',
      _isTemp: true,
      _createdAt: Date.now()
    };
    
    // Save temp settings to JSON
    await saveToJSON(cleanNumber, settings);
    
    console.log(`✅ Created temp settings for ${cleanNumber} (JSON only, no MongoDB document)`);
  }
  
  // Cache settings
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
      // Skip temp settings
      if (settings._isTemp) {
        syncQueue.delete(ownerNumber);
        continue;
      }
      
      // Remove internal metadata
      const { _source, _lastLoaded, _lastUpdated, _isTemp, ...cleanSettings } = settings;
      
      // Prepare update operation
      const updateDoc = {
        $set: {
          ...cleanSettings,
          _updatedAt: now
        },
        $setOnInsert: {
          _createdAt: now
        }
      };
      
      operations.push({
        updateOne: {
          filter: { ownerNumber },
          update: updateDoc,
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

// Update settings - this creates MongoDB document if it doesn't exist
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
      _isTemp: false // Mark as permanent
    };
    
    // Update cache
    settingsCache.set(cleanNumber, updatedSettings);
    
    // ALWAYS save to JSON immediately
    await saveToJSON(cleanNumber, updatedSettings);
    
    // Queue for MongoDB sync if connected
    if (isMongoConnected) {
      syncQueue.set(cleanNumber, updatedSettings);
      
      // If this was a temp setting being saved for first time, sync immediately
      if (wasTemp) {
        // Small delay to allow other operations to queue
        setTimeout(async () => {
          if (syncQueue.has(cleanNumber)) {
            try {
              const client = await getMongoClient();
              if (client) {
                const db = client.db(DATABASE_NAME);
                const collection = db.collection(COLLECTION_NAME);
                
                const { _source, _lastLoaded, _lastUpdated, _isTemp, ...cleanSettings } = updatedSettings;
                
                await collection.updateOne(
                  { ownerNumber: cleanNumber },
                  { 
                    $set: {
                      ...cleanSettings,
                      _updatedAt: Date.now()
                    },
                    $setOnInsert: {
                      _createdAt: Date.now()
                    }
                  },
                  { upsert: true }
                );
                
                syncQueue.delete(cleanNumber);
                console.log(`✅ First-time sync to MongoDB for ${cleanNumber}`);
              }
            } catch (error) {
              console.error(`❌ First-time sync failed for ${cleanNumber}:`, error.message);
            }
          }
        }, 1000);
      }
    } else if (wasTemp) {
      console.log(`⚠️ MongoDB not available for first sync of ${cleanNumber}`);
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
          _updatedAt: Date.now()
        },
        $setOnInsert: {
          _createdAt: Date.now()
        }
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
    mongo: null,
    existsInMongoDB: false
  };
  
  // Try MongoDB if connected
  if (isMongoConnected) {
    try {
      const client = await getMongoClient();
      const db = client.db(DATABASE_NAME);
      const collection = db.collection(COLLECTION_NAME);
      
      result.mongo = await collection.findOne({ ownerNumber: cleanNumber });
      result.existsInMongoDB = !!result.mongo;
    } catch (error) {
      // Silent fail
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
  if (mongoClient && isMongoConnected) {
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
  console.log('✅ Settings manager initialized');
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
  
  // Management functions
  closeConnection,
  forceSyncToMongoDB,
  getAllSettings,
  getSyncQueueStatus,
  initializeMongoDB,
  checkMongoDBExists,
  
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
