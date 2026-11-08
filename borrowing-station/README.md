# Borrowing Station

React/Vite interface for the Smart Lending Borrow Station. Student and item scans come from the PN532 reader through the ESP32 WebSocket connection.

## Run

1. Upload `../Borrow_Station_Arduino/Borrow_Station_Arduino.ino` to the ESP32. Register each physical student's card UID and item tag UID in FastAPI. The student must be ACTIVE and the item copy AVAILABLE.
2. Set `VITE_NFC_WS_URL` in `.env.local` to the ESP32 address shown in Serial Monitor. The local value uses the last observed address, `ws://172.20.10.2:81`.
3. Run `npm install`, then `npm run dev`, and open the URL printed by Vite.
4. On Student Identification, scan a student card. On Item Selection, scan each item tag. The ESP32 sends `{"type":"nfc_detected","uid":"..."}` for each physical scan.
5. Allow camera access in the browser. The face must be inside the guide before **Take Photo** becomes available. Review the student, photo, and items, then confirm.

The web page calls real FastAPI endpoints through Vite's `/api` proxy. The default target is `https://rpi5.tailb8495f.ts.net`; override it with `SMART_LENDING_API_URL` in `.env.local` if that address changes. The proxy also works with `npm run preview`. If the API cannot be reached, the station checks previously saved student and item data, queues a loan in IndexedDB, and retries every 30 seconds.

The current API has no photo upload endpoint. The station stores the compressed JPEG as a Data URL in the API's `photo_path` text field. This is retrievable through the loan API, but it is not a filesystem path. The result screen says **Borrowing successful** only after `POST /loans` succeeds; queued requests are labeled separately. It returns to Student Identification after three seconds.

The API contract was tested with one test loan and return; the test copy was AVAILABLE afterward. Camera, face detection, ESP32, PN532, and the full browser flow still require an on-device test. `npm run build` and `npm run lint` only verify the frontend code.
