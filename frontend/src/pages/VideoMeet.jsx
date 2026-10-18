import React, { useRef, useState, useEffect } from "react";
import { TextField, Button, IconButton, Badge } from "@mui/material";
import io from "socket.io-client";
import { useNavigate, useParams } from "react-router-dom";
import styles from "../styles/videoComponent.module.css";
import VideocamOffTwoToneIcon from '@mui/icons-material/VideocamOffTwoTone';
import VideocamTwoToneIcon from '@mui/icons-material/VideocamTwoTone';
import CallEndTwoToneIcon from '@mui/icons-material/CallEndTwoTone';
import MicOffTwoToneIcon from '@mui/icons-material/MicOffTwoTone';
import MicNoneTwoToneIcon from '@mui/icons-material/MicNoneTwoTone';
import ScreenShare from '@mui/icons-material/ScreenShareTwoTone';
import ScreenShareOff from '@mui/icons-material/StopScreenShareTwoTone';
import ChatIcon from '@mui/icons-material/Chat';
import PersonIcon from '@mui/icons-material/Person';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import '../App.css';

import { server } from "../environment";

// Used only if the backend can't give us TURN credentials: STUN works on most home networks.
const FALLBACK_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

// A black video track and a silent audio track. We always send exactly ONE video and ONE audio
// track to every peer; when the camera / mic is off we send these instead. That way turning
// things on/off is just a track swap (replaceTrack) — no new offer/answer needed.
const makeBlackTrack = ({ width = 640, height = 480 } = {}) => {
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    const ctx = canvas.getContext("2d");
    ctx.fillRect(0, 0, width, height);
    const track = canvas.captureStream().getVideoTracks()[0];
    // keep painting so the other side really shows black (not the last camera frame frozen)
    const timer = setInterval(() => ctx.fillRect(0, 0, width, height), 500);
    const stopTrack = track.stop.bind(track);
    track.stop = () => { clearInterval(timer); stopTrack(); };
    return track;
};

const makeSilentTrack = () => {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const dst = oscillator.connect(ctx.createMediaStreamDestination());
    oscillator.start();
    const track = dst.stream.getAudioTracks()[0];
    track.enabled = false; // silence
    return track;
};

export default function VideoMeetComponent() {

    const { url: meetingCode } = useParams(); // the room is ONLY the meeting code from /:url

    const socketRef = useRef(null);
    const socketIdRef = useRef(null);
    const localVideoRef = useRef(null);

    // one entry per other participant: { pc, polite, makingOffer, ignoreOffer, videoSender, audioSender }
    const peersRef = useRef({});
    const iceServersRef = useRef(FALLBACK_ICE_SERVERS);

    // the real devices (null when off / not allowed) + the placeholders
    const cameraTrackRef = useRef(null);
    const micTrackRef = useRef(null);
    const screenTrackRef = useRef(null);
    const blackTrackRef = useRef(null);
    const silentTrackRef = useRef(null);
    const sendStreamRef = useRef(null); // stable stream id that groups our 2 tracks for the other side

    const videoRef = useRef([]);

    let [video, setVideo] = useState(false); // camera currently on
    let [audio, setAudio] = useState(false); // mic currently on
    let [screen, setScreen] = useState(false); // screen share active
    let [showModal, setModal] = useState(true);
    const [screenAvailable] = useState(() => Boolean(navigator.mediaDevices?.getDisplayMedia)); // browser supports screen sharing
    let [messages, setMessages] = useState([]); // all chat messages
    let [message, setMessage] = useState(""); // current chat message
    let [newMessages, setNewMessages] = useState(0); // unread messages
    let [askForUsername, setaskForUsername] = useState(true); // lobby screen
    let [username, setUsername] = useState("");
    let [videos, setVideos] = useState([]);
    let [participants, setParticipants] = useState([]);
    let [showPeople, setShowPeople] = useState(false);

    // ---------- tracks ----------

    const getBlackTrack = () => {
        if (!blackTrackRef.current) blackTrackRef.current = makeBlackTrack();
        return blackTrackRef.current;
    };

    const getSilentTrack = () => {
        if (!silentTrackRef.current) silentTrackRef.current = makeSilentTrack();
        return silentTrackRef.current;
    };

    // what we send right now: screen > camera > black
    const currentVideoTrack = () => screenTrackRef.current || cameraTrackRef.current || getBlackTrack();
    const currentAudioTrack = () => micTrackRef.current || getSilentTrack();

    const showLocalPreview = () => {
        if (!localVideoRef.current) return;
        const tracks = [screenTrackRef.current || cameraTrackRef.current].filter(Boolean);
        localVideoRef.current.srcObject = tracks.length ? new MediaStream(tracks) : null;
    };

    // swap the outgoing video track on every connection — no renegotiation needed
    const applyVideoTrack = () => {
        const track = currentVideoTrack();
        Object.values(peersRef.current).forEach((peer) => {
            peer.videoSender?.replaceTrack(track).catch((e) => console.log(e));
        });
        showLocalPreview();
    };

    const applyAudioTrack = () => {
        const track = currentAudioTrack();
        Object.values(peersRef.current).forEach((peer) => {
            peer.audioSender?.replaceTrack(track).catch((e) => console.log(e));
        });
    };

    // ---------- 1) ask for camera + mic ONCE (in the lobby) ----------

    const getPermissions = async (isCancelled) => {
        let stream = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch {
            // maybe only one of the two is allowed / present — try them separately
            const onlyVideo = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
            const onlyAudio = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
            stream = new MediaStream([...(onlyVideo?.getTracks() ?? []), ...(onlyAudio?.getTracks() ?? [])]);
        }
        if (isCancelled()) {
            // the page was already left (or React re-ran the effect) — release the devices
            stream.getTracks().forEach((t) => t.stop());
            return;
        }
        cameraTrackRef.current = stream.getVideoTracks()[0] || null;
        micTrackRef.current = stream.getAudioTracks()[0] || null;
        showLocalPreview();
        // the user clicked "Connect" before the browser's permission popup was answered:
        // switch the running call over to the real camera + mic now
        if (sendStreamRef.current) {
            setVideo(Boolean(cameraTrackRef.current));
            setAudio(Boolean(micTrackRef.current));
            applyVideoTrack();
            applyAudioTrack();
        }
    };

    // ---------- 2) leave properly (End call button AND leaving the page) ----------

    const leaveCall = () => {
        Object.values(peersRef.current).forEach((peer) => {
            try { peer.pc.close(); } catch (e) { console.log(e); }
        });
        peersRef.current = {};
        if (socketRef.current) {
            socketRef.current.disconnect(); // the server tells everyone "user-left"
            socketRef.current = null;
        }
        [cameraTrackRef, micTrackRef, screenTrackRef, blackTrackRef, silentTrackRef].forEach((ref) => {
            ref.current?.stop();
            ref.current = null;
        });
    };

    useEffect(() => {
        let cancelled = false;
        getPermissions(() => cancelled);
        return () => {
            cancelled = true;
            leaveCall(); // runs when this page is left in ANY way
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // the meeting view has its own <video> element — attach our preview to it after switching
    useEffect(() => {
        showLocalPreview();
    }, [askForUsername]);

    // ---------- 3) one RTCPeerConnection per other participant ("perfect negotiation") ----------

    const sendSignal = (toId, payload) => {
        socketRef.current?.emit("signal", toId, JSON.stringify(payload));
    };

    const upsertRemoteVideo = (peerId, stream) => {
        setVideos((list) => {
            const exists = list.some((v) => v.socketId === peerId);
            const updated = exists
                ? list.map((v) => (v.socketId === peerId ? { ...v, stream } : v))
                : [...list, { socketId: peerId, stream, autoPlay: true, playsinline: true }];
            videoRef.current = updated;
            return updated;
        });
    };

    const createPeer = (peerId) => {
        const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
        const peer = {
            pc,
            // both sides compute the same answer, so exactly one of them is "polite"
            polite: socketIdRef.current < peerId,
            makingOffer: false,
            ignoreOffer: false,
            pendingCandidates: [], // ICE candidates that arrived before the offer/answer
        };
        peersRef.current[peerId] = peer;

        // modern API (addTrack / ontrack) instead of the deprecated addStream / onaddstream
        peer.videoSender = pc.addTrack(currentVideoTrack(), sendStreamRef.current);
        peer.audioSender = pc.addTrack(currentAudioTrack(), sendStreamRef.current);

        pc.onicecandidate = ({ candidate }) => {
            if (candidate) sendSignal(peerId, { candidate });
        };

        // fires when tracks are first added; both sides may fire at once — handled below
        pc.onnegotiationneeded = async () => {
            try {
                peer.makingOffer = true;
                const offer = await pc.createOffer();
                if (pc.signalingState !== "stable") return; // the other side's offer arrived first
                await pc.setLocalDescription(offer);
                sendSignal(peerId, { description: pc.localDescription });
            } catch (e) {
                // if the other side's offer won the race, perfect negotiation answers it instead
                if (pc.signalingState !== "have-remote-offer") console.log(e);
            } finally {
                peer.makingOffer = false;
            }
        };

        pc.ontrack = ({ streams }) => {
            if (streams[0]) upsertRemoteVideo(peerId, streams[0]);
        };

        return peer;
    };

    const gotMessageFromServer = async (fromId, raw) => {
        if (fromId === socketIdRef.current) return;
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        const peer = peersRef.current[fromId] || createPeer(fromId);
        const { pc } = peer;

        try {
            if (msg.description) {
                // "glare": both sides sent an offer at the same time.
                // The impolite side ignores the other's offer; the polite side rolls back and answers.
                const offerCollision =
                    msg.description.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
                const ignoreOffer = !peer.polite && offerCollision;
                peersRef.current[fromId].ignoreOffer = ignoreOffer;
                if (ignoreOffer) return;

                if (offerCollision) {
                    // polite side: undo our own offer, then accept theirs
                    await pc.setLocalDescription({ type: "rollback" });
                }
                await pc.setRemoteDescription(msg.description);
                // now that the remote description exists, add candidates that arrived too early
                const early = peersRef.current[fromId]?.pendingCandidates.splice(0) || [];
                for (const c of early) {
                    await pc.addIceCandidate(c).catch(() => {});
                }
                if (msg.description.type === "offer") {
                    await pc.setLocalDescription(await pc.createAnswer());
                    sendSignal(fromId, { description: pc.localDescription });
                }
            } else if (msg.candidate) {
                // a candidate can overtake its offer on the way here — keep it until the offer is set
                if (!pc.remoteDescription) {
                    peersRef.current[fromId].pendingCandidates.push(msg.candidate);
                    return;
                }
                try {
                    await pc.addIceCandidate(msg.candidate);
                } catch (e) {
                    if (!peersRef.current[fromId]?.ignoreOffer) throw e;
                }
            }
        } catch (e) {
            console.log(e);
        }
    };

    // ---------- chat ----------

    const addMessage = (data, sender, socketIdSender) => {
        setMessages((prev) => [...prev, { sender, data }]);
        if (socketIdSender !== socketIdRef.current) {
            setNewMessages((n) => n + 1);
        }
    };

    // ---------- 4) connect to the signaling server ----------

    const loadIceServers = async () => {
        try {
            const res = await fetch(`${server}/api/v1/ice-servers`);
            const list = res.ok ? await res.json() : null;
            if (Array.isArray(list) && list.length) iceServersRef.current = list;
        } catch (e) {
            console.log("Using fallback STUN server:", e);
        }
    };

    const connectToSocketServer = () => {
        const socket = io(server);
        socketRef.current = socket;

        socket.on("signal", gotMessageFromServer);
        socket.on("participants", (list) => setParticipants(list));
        socket.on("chat-message", addMessage);

        socket.on("user-left", (id) => {
            setVideos((list) => {
                const updated = list.filter((v) => v.socketId !== id);
                videoRef.current = updated;
                return updated;
            });
            const peer = peersRef.current[id];
            if (peer) {
                try { peer.pc.close(); } catch (e) { console.log(e); }
                delete peersRef.current[id];
            }
        });

        socket.on("user-joined", (id, clients) => {
            if (id === socketIdRef.current) {
                // I just joined: connect to everyone already in the meeting
                clients.forEach((otherId) => {
                    if (otherId !== socketIdRef.current && !peersRef.current[otherId]) createPeer(otherId);
                });
            } else if (!peersRef.current[id]) {
                // someone new joined: connect to them
                createPeer(id);
            }
        });

        socket.on("connect", () => {
            socketIdRef.current = socket.id;
            socket.emit("join-call", meetingCode, username || "Guest");
        });
    };

    let routeTo = useNavigate();

    let connect = async () => {
        setaskForUsername(false);
        setVideo(Boolean(cameraTrackRef.current));
        setAudio(Boolean(micTrackRef.current));
        sendStreamRef.current = new MediaStream();
        await loadIceServers(); // TURN credentials come from OUR backend now, never from the code
        connectToSocketServer();
    };

    // ---------- 5) camera / mic / screen = track swaps, not new offers ----------

    let handleVideo = async () => {
        if (video) {
            cameraTrackRef.current?.stop(); // camera light turns off
            cameraTrackRef.current = null;
            setVideo(false);
            applyVideoTrack(); // others see black
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            cameraTrackRef.current = stream.getVideoTracks()[0];
            setVideo(true);
            applyVideoTrack();
        } catch (e) {
            console.log(e); // camera blocked or unplugged
        }
    };

    let handlleAudio = async () => {
        if (micTrackRef.current) {
            const next = !audio;
            micTrackRef.current.enabled = next; // instant mute / unmute
            setAudio(next);
            return;
        }
        // no mic yet (permission was not given at the start): ask now and swap it in
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micTrackRef.current = stream.getAudioTracks()[0];
            setAudio(true);
            applyAudioTrack();
        } catch (e) {
            console.log(e); // microphone blocked or missing
        }
    };

    const stopScreenShare = () => {
        screenTrackRef.current?.stop();
        screenTrackRef.current = null;
        setScreen(false);
        applyVideoTrack(); // back to camera (or black)
    };

    let handleScreen = async () => {
        if (screenTrackRef.current) {
            stopScreenShare();
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const track = stream.getVideoTracks()[0];
            track.onended = stopScreenShare; // browser's own "Stop sharing" button
            screenTrackRef.current = track;
            setScreen(true);
            applyVideoTrack();
        } catch (e) {
            console.log(e); // user cancelled the picker
        }
    };

    let sendMessage = () => {
        const text = (message || "").trim();
        if (!text || !socketRef.current) return;
        socketRef.current.emit("chat-message", text, username);
        setMessage("");
    };

    let handleEndCall = () => {
        leaveCall();
        routeTo("/home");
    };


    return (
        <div>
            {askForUsername === true ?
                <div className="lobbyPageContainer">
                    <div className="lobbyCard">
                        <div className="lobbyHeader">
                            <div className="lobbyIconCircle">
                                <PersonIcon sx={{ fontSize: '2.2rem', color: '#FF9839' }} />
                            </div>
                            <h2 className="lobbyTitle">Join Meeting</h2>
                            <p className="lobbySubtext">Enter your display name to continue</p>
                        </div>

                        <div className="lobbyForm">
                            <TextField
                                id="lobby-username"
                                placeholder="Your display name"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                variant="outlined"
                                fullWidth
                                sx={{
                                    '& .MuiOutlinedInput-root': {
                                        backgroundColor: 'rgba(255,255,255,0.05)',
                                        borderRadius: '14px',
                                        color: '#fff',
                                        fontSize: '1rem',
                                        '& fieldset': {
                                            borderColor: 'rgba(255,255,255,0.12)',
                                            transition: 'border-color 0.3s ease',
                                        },
                                        '&:hover fieldset': {
                                            borderColor: 'rgba(255,152,57,0.4)',
                                        },
                                        '&.Mui-focused fieldset': {
                                            borderColor: '#FF9839',
                                            boxShadow: '0 0 0 3px rgba(255,152,57,0.1)',
                                        },
                                    },
                                    '& .MuiInputBase-input': {
                                        padding: '14px 18px',
                                        '&::placeholder': {
                                            color: 'rgba(255,255,255,0.35)',
                                            opacity: 1,
                                        },
                                    },
                                }}
                            />
                            <Button
                                variant="contained"
                                onClick={connect}
                                fullWidth
                                sx={{
                                    background: 'linear-gradient(135deg, #FF9839 0%, #ff5e62 100%)',
                                    color: '#fff',
                                    fontWeight: 600,
                                    fontSize: '1.05rem',
                                    padding: '14px',
                                    borderRadius: '14px',
                                    textTransform: 'none',
                                    boxShadow: '0 8px 25px rgba(255,152,57,0.3)',
                                    transition: 'all 0.3s ease',
                                    '&:hover': {
                                        background: 'linear-gradient(135deg, #e68933 0%, #e65050 100%)',
                                        transform: 'translateY(-2px)',
                                        boxShadow: '0 12px 35px rgba(255,152,57,0.4)',
                                    },
                                }}
                            >
                                Connect
                            </Button>
                        </div>

                        <div className="lobbyVideoPreview">
                            <video ref={localVideoRef} autoPlay muted></video>
                        </div>
                    </div>
                </div> :
                <div className={styles.meetVideoContainer}>

                    {showModal ? <div className={styles.chatRoom}>
                        <div className={styles.chatContainer}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '18px 24px 14px',
                                borderBottom: '1px solid rgba(255,255,255,0.06)',
                                flexShrink: 0,
                            }}>
                                <h1 style={{
                                    margin: 0,
                                    fontSize: '1.3rem',
                                    fontWeight: 700,
                                    color: '#fff',
                                    padding: 0,
                                    border: 'none',
                                }}>Chat</h1>
                                <IconButton
                                    onClick={() => { setModal(false); }}
                                    sx={{
                                        color: 'rgba(255,255,255,0.5)',
                                        '&:hover': { color: '#ff5e62', background: 'rgba(255,94,98,0.1)' },
                                    }}
                                    size="small"
                                >
                                    <CloseRoundedIcon />
                                </IconButton>
                            </div>

                            <div className={styles.chattingDisplay}>

                                {messages.length > 0 ? messages.map((item, index) => {
                                    return (
                                        <div key={index} style={{
                                            padding: '10px 14px',
                                            background: 'rgba(255,255,255,0.04)',
                                            borderRadius: '12px',
                                            border: '1px solid rgba(255,255,255,0.05)',
                                        }}>
                                            <p style={{
                                                fontWeight: 600,
                                                fontSize: '0.85rem',
                                                color: '#FF9839',
                                                margin: '0 0 4px 0',
                                            }}>{item.sender}</p>
                                            <p style={{
                                                margin: 0,
                                                fontSize: '0.9rem',
                                                color: 'rgba(255,255,255,0.85)',
                                                lineHeight: 1.5,
                                            }}>{item.data}</p>
                                        </div>
                                    )
                                }) : <p style={{
                                    color: 'rgba(255,255,255,0.3)',
                                    textAlign: 'center',
                                    marginTop: '2rem',
                                    fontSize: '0.9rem',
                                }}>Start a conversation</p>}

                            </div>
                            <div className={styles.chattingArea}>
                                <TextField
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
                                    id="chat-input"
                                    placeholder="Type a message..."
                                    variant="outlined"
                                    fullWidth
                                    size="small"
                                    sx={{
                                        '& .MuiOutlinedInput-root': {
                                            backgroundColor: 'rgba(255,255,255,0.05)',
                                            borderRadius: '12px',
                                            color: '#fff',
                                            fontSize: '0.9rem',
                                            '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                                            '&:hover fieldset': { borderColor: 'rgba(255,152,57,0.3)' },
                                            '&.Mui-focused fieldset': { borderColor: '#FF9839' },
                                        },
                                        '& .MuiInputBase-input::placeholder': {
                                            color: 'rgba(255,255,255,0.3)',
                                            opacity: 1,
                                        },
                                    }}
                                />
                                <IconButton
                                    onClick={sendMessage}
                                    sx={{
                                        background: 'linear-gradient(135deg, #FF9839, #ff5e62)',
                                        color: '#fff',
                                        borderRadius: '12px',
                                        width: '42px',
                                        height: '42px',
                                        flexShrink: 0,
                                        '&:hover': {
                                            background: 'linear-gradient(135deg, #e68933, #e65050)',
                                        },
                                    }}
                                >
                                    <SendRoundedIcon fontSize="small" />
                                </IconButton>
                            </div>
                        </div>
                    </div> : <></>}

                    {showPeople ? <div className={styles.chatRoom}>
                        <div className={styles.chatContainer}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '18px 24px 14px',
                                borderBottom: '1px solid rgba(255,255,255,0.06)',
                                flexShrink: 0,
                            }}>
                                <h1 style={{
                                    margin: 0,
                                    fontSize: '1.3rem',
                                    fontWeight: 700,
                                    color: '#fff',
                                    padding: 0,
                                    border: 'none',
                                }}>Participants ({participants.length})</h1>
                                <IconButton
                                    onClick={() => { setShowPeople(false); }}
                                    sx={{
                                        color: 'rgba(255,255,255,0.5)',
                                        '&:hover': { color: '#ff5e62', background: 'rgba(255,94,98,0.1)' },
                                    }}
                                    size="small"
                                >
                                    <CloseRoundedIcon />
                                </IconButton>
                            </div>

                            <div className={styles.chattingDisplay}>
                                {participants.map((p) => (
                                    <div key={p.id} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        padding: '10px 14px',
                                        background: 'rgba(255,255,255,0.04)',
                                        borderRadius: '12px',
                                        border: '1px solid rgba(255,255,255,0.05)',
                                    }}>
                                        <div style={{
                                            width: '34px',
                                            height: '34px',
                                            borderRadius: '50%',
                                            background: 'linear-gradient(135deg, #FF9839, #ff5e62)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#fff',
                                            fontWeight: 700,
                                            flexShrink: 0,
                                        }}>{p.name.charAt(0).toUpperCase()}</div>
                                        <p style={{
                                            margin: 0,
                                            fontSize: '0.95rem',
                                            color: 'rgba(255,255,255,0.85)',
                                        }}>{p.name}{p.id === socketIdRef.current ? ' (You)' : ''}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div> : <></>}


                    <div className={styles.buttonContainers}>
                        <IconButton
                            onClick={handleVideo}
                            sx={{
                                color: video ? '#fff' : '#ff5e62',
                                background: video ? 'rgba(255,255,255,0.08)' : 'rgba(255,94,98,0.15)',
                                borderRadius: '14px',
                                width: '52px',
                                height: '52px',
                                transition: 'all 0.2s ease',
                                '&:hover': { background: video ? 'rgba(255,255,255,0.14)' : 'rgba(255,94,98,0.25)' },
                            }}
                        >
                            {video ? <VideocamTwoToneIcon /> : <VideocamOffTwoToneIcon />}
                        </IconButton>

                        <IconButton
                            onClick={handlleAudio}
                            sx={{
                                color: audio ? '#fff' : '#ff5e62',
                                background: audio ? 'rgba(255,255,255,0.08)' : 'rgba(255,94,98,0.15)',
                                borderRadius: '14px',
                                width: '52px',
                                height: '52px',
                                transition: 'all 0.2s ease',
                                '&:hover': { background: audio ? 'rgba(255,255,255,0.14)' : 'rgba(255,94,98,0.25)' },
                            }}
                        >
                            {audio ? <MicNoneTwoToneIcon /> : <MicOffTwoToneIcon />}
                        </IconButton>

                        <IconButton
                            onClick={handleEndCall}
                            sx={{
                                background: 'linear-gradient(135deg, #ff5e62, #d63031)',
                                color: '#fff',
                                borderRadius: '14px',
                                width: '56px',
                                height: '56px',
                                boxShadow: '0 4px 18px rgba(255,94,98,0.35)',
                                transition: 'all 0.2s ease',
                                '&:hover': {
                                    background: 'linear-gradient(135deg, #e64c50, #b52828)',
                                    transform: 'scale(1.05)',
                                },
                            }}
                        >
                            <CallEndTwoToneIcon />
                        </IconButton>

                        {screenAvailable === true ?
                            <IconButton
                                onClick={handleScreen}
                                sx={{
                                    color: screen ? '#FF9839' : '#fff',
                                    background: screen ? 'rgba(255,152,57,0.15)' : 'rgba(255,255,255,0.08)',
                                    borderRadius: '14px',
                                    width: '52px',
                                    height: '52px',
                                    transition: 'all 0.2s ease',
                                    '&:hover': { background: screen ? 'rgba(255,152,57,0.25)' : 'rgba(255,255,255,0.14)' },
                                }}
                            >
                                {screen ? <ScreenShare /> : <ScreenShareOff />}
                            </IconButton> : <></>}

                        <Badge
                            badgeContent={participants.length}
                            sx={{
                                '& .MuiBadge-badge': {
                                    background: 'rgba(255,255,255,0.9)',
                                    color: '#14141c',
                                    fontWeight: 700,
                                    fontSize: '0.7rem',
                                    minWidth: '20px',
                                    height: '20px',
                                    borderRadius: '10px',
                                },
                            }}
                        >
                            <IconButton
                                onClick={() => { setShowPeople(!showPeople); setModal(false); }}
                                sx={{
                                    color: showPeople ? '#FF9839' : '#fff',
                                    background: showPeople ? 'rgba(255,152,57,0.15)' : 'rgba(255,255,255,0.08)',
                                    borderRadius: '14px',
                                    width: '52px',
                                    height: '52px',
                                    transition: 'all 0.2s ease',
                                    '&:hover': { background: showPeople ? 'rgba(255,152,57,0.25)' : 'rgba(255,255,255,0.14)' },
                                }}
                            >
                                <PeopleAltIcon />
                            </IconButton>
                        </Badge>

                        <Badge
                            badgeContent={newMessages}
                            max={99}
                            sx={{
                                '& .MuiBadge-badge': {
                                    background: 'linear-gradient(135deg, #FF9839, #ff5e62)',
                                    color: '#fff',
                                    fontWeight: 700,
                                    fontSize: '0.7rem',
                                    minWidth: '20px',
                                    height: '20px',
                                    borderRadius: '10px',
                                    boxShadow: '0 2px 8px rgba(255,152,57,0.4)',
                                },
                            }}
                        >
                            <IconButton
                                onClick={() => { setModal(!showModal); setShowPeople(false); setNewMessages(0); }}
                                sx={{
                                    color: showModal ? '#FF9839' : '#fff',
                                    background: showModal ? 'rgba(255,152,57,0.15)' : 'rgba(255,255,255,0.08)',
                                    borderRadius: '14px',
                                    width: '52px',
                                    height: '52px',
                                    transition: 'all 0.2s ease',
                                    '&:hover': { background: showModal ? 'rgba(255,152,57,0.25)' : 'rgba(255,255,255,0.14)' },
                                }}
                            >
                                <ChatIcon />
                            </IconButton>
                        </Badge>
                    </div>

                    <video className={styles.meetUserVideo} ref={localVideoRef} autoPlay muted></video>
                    <div className={styles.conferenceView}>
                        {videos.map((video) => (

                            <div key={video.socketId} style={{ position: 'relative' }}>

                                <video
                                    data-socket={video.socketId}
                                    ref={ref => {
                                        if (ref && video.stream) {
                                            ref.srcObject = video.stream;
                                        }
                                    }} autoPlay></video>
                                <span style={{
                                    position: 'absolute',
                                    left: '12px',
                                    bottom: '12px',
                                    padding: '4px 10px',
                                    borderRadius: '8px',
                                    background: 'rgba(0,0,0,0.55)',
                                    color: '#fff',
                                    fontSize: '0.8rem',
                                    fontWeight: 600,
                                }}>{(participants.find((p) => p.id === video.socketId) || {}).name || 'Guest'}</span>
                            </div>

                        ))}
                    </div>

                </div>}
        </div>
    );
}