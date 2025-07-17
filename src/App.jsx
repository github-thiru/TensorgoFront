import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import "./App.css";

const socket = io(import.meta.env.VITE_BACKEND_URL, { transports: ["websocket"] });

function App() {
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");
  const [inRoom, setInRoom] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerRef = useRef(null);
  const otherUser = useRef(null);

  useEffect(() => {
    socket.on("user-joined", ({ id, name }) => {
      setMessages(prev => [...prev, { from: "System", message: `${name} joined the room` }]);
      handleUserJoined(id);
    });

    socket.on("ready", (userId) => {
      otherUser.current = userId;
      callUser(userId);

      // 🔁 This ensures both users establish the connection
      socket.emit("ready", roomId);
    });

    socket.on("user-left", (name) => {
      setMessages(prev => [...prev, { from: "System", message: `${name} left the room` }]);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    });

    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ice-candidate", handleNewICECandidateMsg);
    socket.on("receive-message", ({ from, message }) => {
      setMessages(prev => [...prev, { from, message }]);
    });
  }, []);

  const joinRoom = async () => {
    setInRoom(true);
    setTimeout(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      socket.emit("join-room", { roomId, userName });
      socket.emit("ready", roomId); // 🔁 Triggers signaling
    }, 100);
  };

  const leaveRoom = () => {
    const tracks = localVideoRef.current?.srcObject?.getTracks();
    tracks?.forEach(track => track.stop());

    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }

    localVideoRef.current.srcObject = null;
    remoteVideoRef.current.srcObject = null;

    socket.disconnect();
    setInRoom(false);
    setMessages([]);
    setUserName("");
    setRoomId("");
  };

  function handleUserJoined(userId) {
    otherUser.current = userId;
    callUser(userId);
  }

  async function callUser(userId) {
    const peer = createPeer(userId);
    peerRef.current = peer;

    const stream = localVideoRef.current.srcObject;
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
  }

  function createPeer(userId) {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    peer.onicecandidate = e => {
      if (e.candidate) {
        socket.emit("ice-candidate", {
          to: userId,
          candidate: e.candidate
        });
      }
    };

    peer.ontrack = e => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0];
      }
    };

    peer.createOffer().then(offer => {
      return peer.setLocalDescription(offer);
    }).then(() => {
      socket.emit("offer", {
        to: userId,
        offer: peer.localDescription
      });
    });

    return peer;
  }

  function handleOffer(data) {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    peerRef.current = peer;
    otherUser.current = data.from;

    const stream = localVideoRef.current.srcObject;
    stream.getTracks().forEach(track => peer.addTrack(track, stream));

    peer.ontrack = e => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0];
      }
    };

    peer.onicecandidate = e => {
      if (e.candidate) {
        socket.emit("ice-candidate", {
          to: data.from,
          candidate: e.candidate
        });
      }
    };

    peer.setRemoteDescription(new RTCSessionDescription(data.offer)).then(() => {
      return peer.createAnswer();
    }).then(answer => {
      return peer.setLocalDescription(answer);
    }).then(() => {
      socket.emit("answer", {
        to: data.from,
        answer: peer.localDescription
      });
    });
  }

  function handleAnswer(data) {
    const desc = new RTCSessionDescription(data.answer);
    peerRef.current.setRemoteDescription(desc);
  }

  function handleNewICECandidateMsg(data) {
    const candidate = new RTCIceCandidate(data.candidate);
    peerRef.current.addIceCandidate(candidate);
  }

  const handleSendMessage = () => {
    if (newMessage.trim() === "") return;
    socket.emit("send-message", { roomId, message: newMessage });
    setMessages(prev => [...prev, { from: "Me", message: newMessage }]);
    setNewMessage("");
  };

  return (
    <>
      {!inRoom ? (
        <div className="card p-4 shadow " style={{ width: "50%", marginLeft: "30vw" }}>
          <h2 className="mb-4 fw-bold text-center">Real-Time Video Call and Chat</h2>
          <input
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Enter Your Name"
            className="form-control mb-3"
          />
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Enter Room ID"
            className="form-control mb-3"
          />
          <button onClick={joinRoom} className="btn btn-primary w-100">Join Room</button>
        </div>
      ) : (
        <div className="text-center w-100 px-3" style={{ marginLeft: "12vw" }}>
          <div className="row mt-4 justify-content-center">
            <div className="col-md-5 mb-3">
              <video ref={localVideoRef} autoPlay playsInline muted className="w-100 border rounded shadow" />
            </div>
            <div className="col-md-5 mb-3">
              <video ref={remoteVideoRef} autoPlay playsInline className="w-100 border rounded shadow" />
            </div>
          </div>
          <button onClick={leaveRoom} className="btn btn-danger my-3">Leave Room</button>

          <div className="card mx-auto p-3 mt-3 shadow" style={{ maxWidth: "600px" }}>
            <div className="border rounded p-2 mb-3" style={{ height: "200px", overflowY: "auto" }}>
              {messages.map((msg, index) => (
                <div key={index}><strong>{msg.from}:</strong> {msg.message}</div>
              ))}
            </div>
            <div className="input-group">
              <input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message"
                className="form-control"
              />
              <button onClick={handleSendMessage} className="btn btn-success">Send</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
