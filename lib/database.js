const { MongoClient } = require('mongodb');

// 数据库连接配置
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(uri);
const dbName = 'todo_app';

let db;

// 连接数据库
async function connectDB() {
  if (db) return db;

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
    throw error;
  }
}

// 关闭数据库连接
async function closeDB() {
  if (client) {
    await client.close();
  }
}

module.exports = { connectDB, closeDB };