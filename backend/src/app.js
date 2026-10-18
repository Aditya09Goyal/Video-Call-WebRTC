import path from "path";
import express from 'express';
import { createServer } from  "node:http";
import dotenv from 'dotenv';
import dns from 'node:dns';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

// Optional: on some Windows / campus networks Node's own DNS lookup for MongoDB (SRV record) times out,
// even though the system DNS works. Put DNS_SERVERS=8.8.8.8,1.1.1.1 in .env to make Node use those.
if (process.env.DNS_SERVERS) {
    dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean));
}

import { Server } from "socket.io";

import mongoose from 'mongoose';
import cors from 'cors';

import userRoutes from './routes/users.routes.js';
import { getIceServers } from './controllers/turn.controller.js';

const app = express();

import { connectToSocket } from './controllers/socketManager.js';

const server = createServer(app);
const io = connectToSocket(server);


app.set("port", (process.env.PORT || 8080));
app.use(cors());
app.use(express.json({ limit: '40kb' }));
app.use(express.urlencoded({ limit: '40kb', extended: true }));

app.use("/api/v1/users", userRoutes);
app.get("/api/v1/ice-servers", getIceServers); // TURN credentials for WebRTC

app.get("/home", (req, res) => {
    return res.json({"hello": "world"});
})

app.use(express.static(path.join(__dirname, "../../frontend/dist")));

app.get(/.*/, (req, res) => {
    res.redirect("/"); 
});

const start = async () => {
    const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_CLUSTER}`;
    await mongoose.connect(uri);
    console.log(`MongoDB connected: ${mongoose.connection.host}`); // Tells us the host name to which the mongoDb is connected
    server.listen(app.get("port"), () => {
        console.log(`Server is running on port ${app.get("port")}`);
    })
}
start();