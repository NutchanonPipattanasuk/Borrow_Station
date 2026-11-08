
import { useEffect, useRef, useState } from "react";
import { getItemCopy, getStudent, initializeStationDb } from "./stationDb";
import { findOnlineItemCopy, findOnlineStudent, syncReferenceData } from "./stationSync";
import { connectNfcReader } from "./stationNfc";
import { makeLoan, submitLoan, syncPendingLoans } from "./stationLoans";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import "./App.css";

type Step = "student" | "camera" | "items" | "review" | "result";
type StudentPhase = "Waiting" | "Verifying" | "Offline_Verifying" | "Verified" | "Failed";

type Item = {
  id: string;
  name: string;
  category?: string;
};

type Student = {
  studentId: string;
  name?: string;
};

const studentPhaseLabel: Record<StudentPhase, string> = {
  Waiting: "Waiting for card",
  Verifying: "Checking student",
  Offline_Verifying: "Checking saved data",
  Verified: "Verified",
  Failed: "Verification failed",
};

const steps: { id: Step; title: string }[] = [
  { id: "student", title: "Student Identification" },
  { id: "camera", title: "Face Capture" },
  { id: "items", title: "Item Selection" },
  { id: "review", title: "Review & Confirm" },
];

function App() {
  const [step, setStep] = useState<Step>("student");
  const stepRef = useRef(step);
  const [student, setStudent] = useState<Student | null>(null);
  const cameraVideo = useRef<HTMLVideoElement | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [faceReady, setFaceReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [studentPhase, setStudentPhase] = useState<StudentPhase>("Waiting");
  const studentPhaseRef = useRef<StudentPhase>("Waiting");
  const verificationId = useRef(0);
  const itemScanId = useRef(0);
  const itemScanInFlight = useRef(new Map<string, number>());
  const [readerRetry, setReaderRetry] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [resultState, setResultState] = useState<"sent" | "queued" | null>(null);
  const [dueDates, setDueDates] = useState<{ item_copy_id: string; due_at: string }[]>([]);
  const [readerStatus, setReaderStatus] = useState(
    import.meta.env.VITE_NFC_WS_URL ? "Connecting..." : "Reader is not configured",
  );
  const [scanMessage, setScanMessage] = useState("");

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  function changeStudentPhase(phase: StudentPhase) {
    studentPhaseRef.current = phase;
    setStudentPhase(phase);
  }

  async function verifyStudent(uid: string) {
    if (studentPhaseRef.current !== "Waiting") return;
    const currentVerification = ++verificationId.current;
    changeStudentPhase("Verifying");
    setStudent(null);
    setScanMessage("Checking student details...");

    try {
      const record = await findOnlineStudent(uid);
      if (verificationId.current !== currentVerification) return;
      if (!record) {
        setScanMessage("This UID was not found in the student database.");
        changeStudentPhase("Failed");
        return;
      }
      if (record.status !== "ACTIVE") {
        setScanMessage(`Student status is ${record.status}. Borrowing cannot continue.`);
        changeStudentPhase("Failed");
        return;
      }
      setStudent({
        studentId: record.student_id,
        name: `${record.first_name} ${record.last_name}`.trim(),
      });
      setScanMessage("Student verified.");
      changeStudentPhase("Verified");
    } catch {
      if (verificationId.current !== currentVerification) return;
      changeStudentPhase("Offline_Verifying");
      setScanMessage("Checking saved student details...");
      try {
        const record = await getStudent(uid);
        if (verificationId.current !== currentVerification) return;
        if (!record) {
          setScanMessage("Student record not found. Please ask a staff member for help.");
          changeStudentPhase("Failed");
          return;
        }
        if (record.status !== "ACTIVE") {
          setScanMessage(`Student status is ${record.status}. Borrowing cannot continue.`);
          changeStudentPhase("Failed");
          return;
        }
        setStudent({
          studentId: record.student_id,
        });
        setScanMessage("Student verified.");
        changeStudentPhase("Verified");
      } catch {
        if (verificationId.current !== currentVerification) return;
        setScanMessage("Student details are unavailable. Please try again later.");
        changeStudentPhase("Failed");
      }
    }
  }

  useEffect(() => {
    initializeStationDb()
      .then(() => {
        void syncReferenceData().catch(() => {
          // Previously saved records remain available when the server is unavailable.
        });
        void syncPendingLoans().catch(() => {});
      })
      .catch(() => {
        // Student verification will show a user-facing error if saved data is needed.
      });
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => { void syncPendingLoans().catch(() => {}); }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  async function verifyItemCopy(uid: string) {
    if (itemScanInFlight.current.has(uid)) return;
    const currentScan = ++itemScanId.current;
    itemScanInFlight.current.clear();
    itemScanInFlight.current.set(uid, currentScan);
    setScanMessage("Checking item tag...");
    let item: Item | null = null;
    try {
      try {
        const record = await findOnlineItemCopy(uid);
        if (currentScan !== itemScanId.current || stepRef.current !== "items") return;
        if (!record) return setScanMessage("This tag is not registered as an item. Remove it and scan an item tag.");
        if (record.status !== "AVAILABLE") return setScanMessage("This item is not available. Remove it and scan another item tag.");
        item = { id: record.item_copy_id, name: record.name, category: record.item_type };
      } catch {
        try {
          const record = await getItemCopy(uid);
          if (currentScan !== itemScanId.current || stepRef.current !== "items") return;
          if (!record) return setScanMessage("Item information is unavailable. Remove the tag and try again.");
          if (record.status !== "AVAILABLE") return setScanMessage("This item is not available. Remove it and scan another item tag.");
          item = { id: record.item_copy_id, name: record.item_copy_id };
        } catch {
          if (currentScan === itemScanId.current) setScanMessage("Item information is unavailable. Remove the tag and try again.");
          return;
        }
      }
      if (currentScan !== itemScanId.current || stepRef.current !== "items" || !item) return;
      const selectedItem = item;
      setItems((previous) => previous.some((record) => record.id === selectedItem.id)
        ? previous : [...previous, selectedItem]);
      setScanMessage(`${selectedItem.name} added to this loan.`);
    } finally {
      if (itemScanInFlight.current.get(uid) === currentScan) itemScanInFlight.current.delete(uid);
    }
  }

  useEffect(() => {
    const url = import.meta.env.VITE_NFC_WS_URL;
    if (!url) return;

    const connection = connectNfcReader(
      url,
      (uid) => {
        if (stepRef.current === "student") {
          void verifyStudent(uid);
        } else if (stepRef.current === "items") {
          void verifyItemCopy(uid);
        }
      },
      setReaderStatus,
    );
    return () => connection.close();
  }, [readerRetry]);

  useEffect(() => {
    if (step !== "camera" || photoDataUrl) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    void Promise.resolve().then(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }))
      .then((cameraStream) => {
        if (cancelled) {
          cameraStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = cameraStream;
        if (cameraVideo.current) cameraVideo.current.srcObject = cameraStream;
      })
      .catch(() => {
        if (!cancelled) setCameraError("Camera unavailable. Check the camera and browser permission.");
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [step, photoDataUrl]);

  useEffect(() => {
    if (step !== "camera" || !cameraReady || photoDataUrl) return;
    let cancelled = false;
    let interval: number | undefined;
    let detector: FaceDetector | undefined;
    void FilesetResolver.forVisionTasks("/wasm")
      .then((wasm) => FaceDetector.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: "/models/blaze_face_short_range.tflite" },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.6,
      }))
      .then((loaded) => {
        if (cancelled) return loaded.close();
        detector = loaded;
        interval = window.setInterval(() => {
          const video = cameraVideo.current;
          if (!video || video.readyState < 2) return;
          try {
            const detections = loaded.detectForVideo(video, performance.now()).detections;
            const box = detections.length === 1 ? detections[0].boundingBox : undefined;
            if (!box) return setFaceReady(false);
            const centerX = (box.originX + box.width / 2) / video.videoWidth;
            const centerY = (box.originY + box.height / 2) / video.videoHeight;
            const relativeWidth = box.width / video.videoWidth;
            setFaceReady(Math.abs(centerX - 0.5) < 0.17 && Math.abs(centerY - 0.5) < 0.2
              && relativeWidth > 0.18 && relativeWidth < 0.7);
          } catch {
            setFaceReady(false);
            setCameraError("Face detection stopped. Please restart this session.");
            if (interval) window.clearInterval(interval);
          }
        }, 400);
      })
      .catch(() => {
        if (!cancelled) setCameraError("Face detection could not start. Please reload the station.");
      });
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      detector?.close();
    };
  }, [step, cameraReady, photoDataUrl]);

  function capturePhoto() {
    const video = cameraVideo.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(video.videoWidth, 480);
    canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhotoDataUrl(canvas.toDataURL("image/jpeg", 0.65));
    setScanMessage("");
    setStep("items");
  }

  function removeItem(id: string) {
    setItems((previous) => previous.filter((x) => x.id !== id));
  }

  function retryItemScan() {
    itemScanId.current += 1;
    itemScanInFlight.current.clear();
    setScanMessage("Remove the previous tag, then tap an item tag again.");
    if (import.meta.env.VITE_NFC_WS_URL) {
      setReaderStatus("Connecting...");
      setReaderRetry((value) => value + 1);
    }
  }

  function resetSession() {
    verificationId.current += 1;
    itemScanId.current += 1;
    itemScanInFlight.current.clear();
    changeStudentPhase("Waiting");
    setStep("student");
    setStudent(null);
    setPhotoDataUrl(null);
    setCameraReady(false);
    setFaceReady(false);
    setCameraError("");
    setItems([]);
    setScanMessage("");
    setSubmitting(false);
    setSubmissionError("");
    setResultState(null);
    setDueDates([]);
  }

  async function confirmBorrowing() {
    if (!student || !photoDataUrl || items.length === 0 || submitting) return;
    setSubmitting(true);
    setSubmissionError("");
    try {
      const outcome = await submitLoan(makeLoan(student.studentId, items.map((item) => item.id), photoDataUrl));
      setResultState(outcome.state);
      setDueDates(outcome.dueDates);
      setStep("result");
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "Could not submit this loan.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (step !== "result") return;
    const timeout = window.setTimeout(resetSession, 3000);
    return () => window.clearTimeout(timeout);
  }, [step]);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Smart Lending</h1>
          <p>Borrowing Station</p>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <h2>Borrowing Process</h2>

          <ol className="steps">
            {steps.map((s, index) => (
              <li
                key={s.id}
                className={step === s.id ? "active" : ""}
              >
                <span>{index + 1}</span>
                {s.title}
              </li>
            ))}
          </ol>

          <button className="secondary" onClick={resetSession}>
            Start New Session
          </button>
        </aside>

        <main className="content">
          <section className="panel">
            {step === "student" && (
              <>
                <h2>Student Identification</h2>
                <p className="step-instruction">Tap your student card to begin borrowing.</p>
                {studentPhase !== "Waiting" && (
                  <p className="status-line">
                    <span className={`student-phase student-phase--${studentPhase}`}>
                      {studentPhaseLabel[studentPhase]}
                    </span>
                  </p>
                )}

                <div className={`placeholder student-result student-result--${studentPhase}`} role="status" aria-live="polite">
                  {studentPhase === "Waiting" && "Waiting for student card..."}
                  {studentPhase === "Verifying" && "Checking student details..."}
                  {studentPhase === "Offline_Verifying" && "Checking saved student details..."}
                  {studentPhase === "Verified" && `Student verified: ${student?.name ?? student?.studentId}`}
                  {studentPhase === "Failed" && (scanMessage || "Student verification failed")}
                </div>

                {studentPhase === "Waiting" && (
                  <>
                    <p className={`reader-help ${readerStatus === "PN532 ready" ? "reader-help--ready" : ""}`} role="status">
                      PN532 Reader: {readerStatus}
                    </p>
                    {scanMessage && <p className="reader-help" role="status">{scanMessage}</p>}
                    {import.meta.env.VITE_NFC_WS_URL && readerStatus !== "PN532 ready" && (
                      <button className="secondary" onClick={() => { setReaderStatus("Connecting..."); setReaderRetry((value) => value + 1); }}>
                        Reconnect PN532 Reader
                      </button>
                    )}
                  </>
                )}

                {studentPhase === "Verified" && (
                  <>
                    <dl className="student-details">
                      <dt>Student name</dt>
                      <dd>{student?.name || "Name unavailable"}</dd>
                      <dt>Student ID</dt>
                      <dd>{student?.studentId}</dd>
                      <dt>Borrowing status</dt>
                      <dd>Ready to continue</dd>
                    </dl>
                    <button onClick={() => setStep("camera")}>Continue to Face Capture</button>
                  </>
                )}

                {studentPhase === "Failed" && (
                  <button className="secondary" onClick={() => { changeStudentPhase("Waiting"); setScanMessage(""); }}>
                    Scan Again
                  </button>
                )}

              </>
            )}

            {step === "camera" && (
              <>
                <h2>Face Capture</h2>
                <p>
                  Position your face in the camera frame before taking a photo.
                </p>

                <div className="camera-frame">
                  <video
                    ref={cameraVideo}
                    className="camera-preview"
                    autoPlay
                    playsInline
                    muted
                    onLoadedMetadata={() => setCameraReady(true)}
                  />
                  <div className={`face-guide ${faceReady ? "face-guide-ready" : ""}`} aria-hidden="true" />
                </div>
                <p role="status">{faceReady ? "Face positioned correctly" : "Move one face into the guide"}</p>
                {cameraError && <p role="alert">{cameraError}</p>}
                <button disabled={!cameraReady || !faceReady || !!cameraError} onClick={capturePhoto}>
                  Take Photo
                </button>
              </>
            )}

            {step === "items" && (
              <>
                <h2>Item Selection</h2>
                <p>Tap an item tag on the PN532 Reader to add it to the loan.</p>
                <p className={`reader-help ${readerStatus === "PN532 ready" ? "reader-help--ready" : ""}`} role="status">
                  PN532 Reader: {readerStatus}
                </p>
                {scanMessage && <p role="status">{scanMessage}</p>}
                <button className="secondary" onClick={retryItemScan}>Scan Again</button>

                <h3>Selected Items</h3>

                {items.length === 0 ? (
                  <p>No items selected yet. Scan an item tag to continue.</p>
                ) : (
                  items.map((item) => (
                    <div className="item-card" key={item.id}>
                      <span>{item.name}</span>
                      <button
                        className="secondary"
                        onClick={() => removeItem(item.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}

                <button
                  disabled={items.length === 0}
                  onClick={() => setStep("review")}
                >
                  Review Borrowing
                </button>
              </>
            )}

            {step === "review" && (
              <>
                <h2>Review & Confirm</h2>
                <p>Review the student and items before confirming the loan.</p>

                <h3>Student</h3>
                <p>{student?.name ?? student?.studentId}</p>

                <h3>Photo</h3>
                {photoDataUrl && <img className="captured-photo" src={photoDataUrl} alt="Captured borrower" />}

                <h3>Items</h3>
                {items.map((item) => (
                  <p key={item.id}>
                    {item.name} ({item.id})
                  </p>
                ))}

                <div className="notice">
                  Confirming will save this loan or keep it on this device until the server returns.
                </div>

                <button
                  className="secondary"
                  onClick={() => setStep("items")}
                >
                  Back to Items
                </button>
                <button disabled={submitting || !photoDataUrl || items.length === 0} onClick={() => void confirmBorrowing()}>
                  {submitting ? "Submitting..." : "Confirm Borrowing"}
                </button>
                {submissionError && <p role="alert">{submissionError}</p>}
              </>
            )}

            {step === "result" && (
              <>
                <h2>Borrowing Result</h2>
                <div className={`placeholder ${resultState === "sent" ? "result-success" : "result-queued"}`} role="status">
                  {resultState === "sent" ? "Borrowing successful" : "Request saved on this device"}
                </div>
                {resultState === "queued" && <p>The loan will be sent when the server is available.</p>}
                {dueDates.map((entry) => (
                  <p key={entry.item_copy_id}>{entry.item_copy_id}: Due {new Date(entry.due_at).toLocaleDateString("en-GB")}</p>
                ))}
                <p>Returning to Student Identification in 3 seconds...</p>
              </>
            )}
          </section>

          <aside className="panel summary">
            <h2>Current Session</h2>

            <p><strong>Student</strong></p>
            <p>{student?.name ?? student?.studentId ?? "Not scanned"}</p>

            <p><strong>Student ID</strong></p>
            <p>{student?.studentId ?? "-"}</p>

            <p><strong>Photo</strong></p>
            <p>{photoDataUrl ? "Captured" : "Not captured"}</p>

            <p><strong>Items Selected</strong></p>
            <p>{items.length}</p>

          </aside>
        </main>
      </div>
    </div>
  );
}

export default App;
