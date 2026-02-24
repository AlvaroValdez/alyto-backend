import * as dotenv from 'dotenv';
dotenv.config();
console.log("MONGO_URI:", process.env.MONGO_URI?.slice(0, 15) + "...");
