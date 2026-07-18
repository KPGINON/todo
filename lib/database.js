const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// 数据库连接配置
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(uri);
const dbName = 'todo_app';

let db;
let usingFileStorage = false;
const DATA_FILE = path.join(__dirname, '..', 'data.json');

// 检查数据文件是否存在
function dataFileExists() {
  return fs.existsSync(DATA_FILE);
}

// 读取数据文件
function readDataFile() {
  if (!dataFileExists()) {
    return { users: [], todos: [], archives: [], settings: {} };
  }
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading data file:', error);
    return { users: [], todos: [], archives: [], settings: {} };
  }
}

// 写入数据文件
function writeDataFile(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing data file:', error);
    return false;
  }
}

// 连接数据库
async function connectDB() {
  if (db) return db;

  // 如果指定了使用文件存储或 MongoDB URI 以 "file:" 开头
  if (process.env.USE_FILE_STORAGE === 'true' ||
      (process.env.MONGODB_URI && process.env.MONGODB_URI.startsWith('file:'))) {
    console.log('Using file-based storage');
    usingFileStorage = true;
    return { name: 'file-storage' };
  }

  try {
    await client.connect();
    db = client.db(dbName);
    console.log('Connected to MongoDB');

    // 创建索引
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    await db.collection('todos').createIndex({ userId: 1 });

    return db;
  } catch (error) {
    console.error('Database connection error:', error);
    console.log('Falling back to file-based storage');
    usingFileStorage = true;
    return { name: 'file-storage' };
  }
}

// 获取是否使用文件存储
function isUsingFileStorage() {
  return usingFileStorage;
}

// 读取所有数据（用于文件存储）
function getAllData() {
  return readDataFile();
}

// 保存所有数据（用于文件存储）
function saveAllData(data) {
  return writeDataFile(data);
}

// 关闭数据库连接
async function closeDB() {
  if (client && !usingFileStorage) {
    await client.close();
  }
}

module.exports = { connectDB, closeDB, isUsingFileStorage, getAllData, saveAllData };