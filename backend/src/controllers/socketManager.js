import { Server } from "socket.io";

// ---- limits so one meeting can't fill the server's memory ----
const MAX_MESSAGE_LENGTH = 1000;   // characters per chat message
const MAX_MESSAGES_PER_ROOM = 200; // only the latest messages are kept for late joiners
const MAX_NAME_LENGTH = 40;
const MAX_ROOM_LENGTH = 100;

let connections = {} // room -> [socketId, ...]
let messages = {}    // room -> [{ sender, data, socket-id-sender }]
let roomOf = {}      // socketId -> room   (who is in which meeting)
let timeOnline = {}
let names = {}

export const connectToSocket = (server) => {
    const io = new Server(server, { // this is to handle error related to CORS policy as the error will occur to the IO and not the express server
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            allowedHeaders: ["*"],
            credentials: true
        }
    });

    const sendParticipants = (room) => {
        if (connections[room] === undefined) return;
        const list = connections[room].map((id) => ({ id: id, name: names[id] || "Guest" }));
        connections[room].forEach((id) => io.to(id).emit("participants", list));
    }

    // removes a socket from its meeting; when the meeting is empty, its chat is deleted too
    const leaveRoom = (socketId) => {
        const room = roomOf[socketId];
        if (room === undefined) return;
        delete roomOf[socketId];

        const list = connections[room] || [];
        const index = list.indexOf(socketId);
        if (index !== -1) list.splice(index, 1);

        list.forEach((id) => io.to(id).emit("user-left", socketId));

        if (list.length === 0) {
            delete connections[room];
            delete messages[room]; // FIX: before, every meeting's chat stayed in memory forever
        } else {
            sendParticipants(room);
        }
    }

    io.on("connection", (socket) => {

        socket.on("join-call", (path, name) => {
            const room = String(path || "").trim().slice(0, MAX_ROOM_LENGTH);
            if (!room) return;

            if (roomOf[socket.id] !== undefined) leaveRoom(socket.id); // one meeting per socket

            if (connections[room] === undefined) {
                connections[room] = []
            }
            connections[room].push(socket.id)
            roomOf[socket.id] = room;

            names[socket.id] = String(name || "Guest").trim().slice(0, MAX_NAME_LENGTH) || "Guest";
            timeOnline[socket.id] = Date.now();

            connections[room].forEach((id) => io.to(id).emit("user-joined", socket.id, connections[room]));

            (messages[room] || []).forEach((m) => {
                socket.emit("chat-message", m['data'], m['sender'], m['socket-id-sender']);
            });

            sendParticipants(room);
        })

        // FIX: only forward WebRTC signals between two people in the SAME meeting
        socket.on("signal", (toId, message) => {
            const room = roomOf[socket.id];
            if (room === undefined || roomOf[toId] !== room) return;
            io.to(toId).emit("signal", socket.id, message);
        })

        socket.on("chat-message", (data) => {
            const room = roomOf[socket.id]; // O(1) lookup instead of scanning every room
            if (room === undefined) return;

            const text = String(data ?? "").trim().slice(0, MAX_MESSAGE_LENGTH);
            if (!text) return;
            const sender = names[socket.id] || "Guest"; // the name the server knows, so it can't be faked

            if (messages[room] === undefined) messages[room] = [];
            messages[room].push({ 'sender': sender, 'data': text, 'socket-id-sender': socket.id });
            if (messages[room].length > MAX_MESSAGES_PER_ROOM) {
                messages[room].splice(0, messages[room].length - MAX_MESSAGES_PER_ROOM);
            }

            connections[room].forEach((id) => io.to(id).emit("chat-message", text, sender, socket.id));
        })

        socket.on("disconnect", () => {
            leaveRoom(socket.id);
            delete names[socket.id];
            delete timeOnline[socket.id];
        })
    })

    return io;
}