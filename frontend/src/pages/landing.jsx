import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/landing.css";

const logLines = [
    <><span className="lp-t">12:26:12</span> socket connected <span className="lp-gr">✓</span></>,
    <><span className="lp-t">12:26:13</span> join-call room=<span className="lp-y">team-sync</span></>,
    <><span className="lp-t">12:26:13</span> sdp offer → answer <span className="lp-gr">stable</span></>,
    <><span className="lp-t">12:26:14</span> ice: host ✗ srflx ✗ <span className="lp-y">relay(tls) ✓</span></>,
    <><span className="lp-t">12:26:14</span> connection → <span className="lp-gr">connected</span> · <span className="lp-cy">640x480 @ 20fps</span></>,
];

const stats = [
    { to: 110, pre: "~", suf: " ms", label: "median RTT", color: "#7CFC9A" },
    { to: 5, pre: "", suf: "", label: "peers / room", color: "#38bdf8" },
    { to: 20, pre: "", suf: " fps", label: "640×480 video", color: "#ff9839" },
    { text: "443/tls", label: "relay fallback", color: "#a78bfa" },
];

function CountUp({ to, pre, suf }) {
    const [n, setN] = useState(0);
    useEffect(() => {
        let start = null, raf;
        const tick = (t) => {
            if (!start) start = t;
            const p = Math.min((t - start) / 1400, 1);
            setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
            if (p < 1) raf = requestAnimationFrame(tick);
        };
        const timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, 700);
        return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
    }, [to]);
    return <>{pre}{n}{suf}</>;
}

const randomCode = () => {
    const s = () => Math.random().toString(36).slice(2, 6);
    return `${s()}-${s()}`;
};

export default function LandingPage() {
    const router = useNavigate();
    const codeRef = useRef(null);

    const [name, setName] = useState("");
    const [code, setCode] = useState("");
    const [lines, setLines] = useState(0);
    const [speaker, setSpeaker] = useState(0);

    useEffect(() => {
        const t = setTimeout(() => setLines((l) => (l >= logLines.length ? 0 : l + 1)), lines >= logLines.length ? 3500 : 700);
        return () => clearTimeout(t);
    }, [lines]);

    useEffect(() => {
        const t = setInterval(() => setSpeaker((x) => (x + 1) % 4), 1800);
        return () => clearInterval(t);
    }, []);

    const go = (room) => {
        const clean = room.trim().replace(/\s+/g, "-");
        if (!clean) { codeRef.current?.focus(); return; }
        try { if (name.trim()) sessionStorage.setItem("vc-name", name.trim()); } catch (e) { }
        router(`/${clean}`);
    };

    const me = name.trim();
    const people = [
        { n: "Aditya", bg: "linear-gradient(135deg,#f97316,#fbbf24)" },
        { n: "Riya", bg: "linear-gradient(135deg,#8b5cf6,#6366f1)", muted: true },
        { n: "Karan", bg: "linear-gradient(135deg,#38bdf8,#2dd4bf)" },
        { n: me ? `You · ${me}` : "You", init: me ? me[0] : "Y", bg: "linear-gradient(135deg,#22c55e,#7CFC9A)", you: true },
    ];

    return (
        <div className="lp">
            <div className="lp-blob lp-b1"></div>
            <div className="lp-blob lp-b2"></div>
            <div className="lp-blob lp-b3"></div>
            <div className="lp-blob lp-b4"></div>
            <div className="lp-grain"></div>

            <nav className="lp-nav lp-reveal">
                <div className="lp-logo" onClick={() => router("/")}><span className="lp-dot"></span>VIDEO-CALL</div>
                <div className="lp-links">
                    <a href="https://github.com/Aditya09Goyal/Video-Call-WebRTC" target="_blank" rel="noreferrer">GitHub</a>
                    <span onClick={() => router("/auth")}>Register</span>
                    <span onClick={() => router("/auth")}>Sign in</span>
                    <span className="lp-ghost" onClick={() => codeRef.current?.focus()}>$ join</span>
                </div>
            </nav>

            <div className="lp-hero">
                <div>
                    <span className="lp-pill lp-reveal" style={{ animationDelay: ".1s" }}>
                        <span className="lp-stack">
                            <span style={{ background: "#f97316" }}>A</span>
                            <span style={{ background: "#8b5cf6" }}>R</span>
                            <span style={{ background: "#38bdf8" }}>K</span>
                        </span>
                        <span className="lp-live"></span>Free · no downloads · no sign-up
                    </span>
                    <h1 className="lp-reveal" style={{ animationDelay: ".2s" }}>Ready to <span className="lp-grad">join?</span></h1>
                    <p className="lp-sub lp-reveal" style={{ animationDelay: ".3s" }}>Jump into a room in seconds. Enter a meeting code to join, or start a new one and share the link.</p>
                    <p className="lp-cmt lp-reveal" style={{ animationDelay: ".4s" }}>// WebRTC mesh · Socket.io signaling · TURN fallback over TLS:443</p>
                    <div className="lp-term lp-reveal" style={{ animationDelay: ".5s" }}>
                        <div className="lp-term-h">
                            <i style={{ background: "#ff5f57" }}></i><i style={{ background: "#febc2e" }}></i><i style={{ background: "#28c840" }}></i>
                            &nbsp; how-a-call-connects.log
                        </div>
                        {logLines.slice(0, lines).map((l, i) => (
                            <div key={i}>{l}{i === lines - 1 && <span className="lp-cur"></span>}</div>
                        ))}
                    </div>
                </div>

                <div className="lp-reveal" style={{ animationDelay: ".35s", position: "relative" }}>
                    <span className="lp-emo" style={{ right: 30, top: 150, animationDelay: "0s" }}>👋</span>
                    <span className="lp-emo" style={{ right: 80, top: 170, animationDelay: "1.5s" }}>🔥</span>
                    <span className="lp-emo" style={{ right: 10, top: 190, animationDelay: "3s" }}>💙</span>
                    <div className="lp-cardwrap">
                        <div className="lp-card">
                            <div className="lp-call">
                                <div className="lp-call-top">
                                    <span className="lp-livetag"><i></i>LIVE</span>
                                    <span className="lp-room">team-sync · 4 peers</span>
                                </div>
                                <div className="lp-grid">
                                    {people.map((p, i) => (
                                        <div key={i} className={`lp-tile ${speaker === i && !p.muted ? "speak" : ""} ${p.you ? "you" : ""}`}>
                                            <div className="lp-face" style={{ background: p.bg }}>{(p.init || p.n[0]).toUpperCase()}</div>
                                            <span className="lp-name">{p.n}</span>
                                            {p.muted
                                                ? <span className="lp-mute">🔇</span>
                                                : <span className={`lp-eqs ${speaker === i ? "on" : ""}`}><i></i><i></i><i></i></span>}
                                        </div>
                                    ))}
                                </div>
                                <div className="lp-bar"><span>🎙</span><span>📷</span><span>🖥</span><span>💬</span><span className="end">✆</span></div>
                            </div>
                            <input className="lp-in" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                            <input className="lp-in" ref={codeRef} placeholder="Meeting code" value={code}
                                onChange={(e) => setCode(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") go(code); }} />
                            <div className="lp-row">
                                <button className="lp-btn lp-new" onClick={() => go(randomCode())}>＋ New meeting</button>
                                <button className="lp-btn lp-join" disabled={!code.trim()} onClick={() => go(code)}>Join now →</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="lp-stats lp-reveal" style={{ animationDelay: ".6s" }}>
                {stats.map((s) => (
                    <div key={s.label} style={{ "--k": s.color }}>
                        <b>{s.text ? s.text : <CountUp to={s.to} pre={s.pre} suf={s.suf} />}</b>
                        <small>{s.label}</small>
                    </div>
                ))}
            </div>
        </div>
    );
}
