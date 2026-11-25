import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'mydb',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export default pool;
