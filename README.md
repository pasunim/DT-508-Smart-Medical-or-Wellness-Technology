# Hand Exercise Tracker

แอปพลิเคชันเว็บสำหรับติดตามและกระตุ้นการออกกำลังกายมือ (กำ-แบมือ) โดยใช้ **MediaPipe Hands** ตรวจจับตำแหน่งมือผ่านเว็บแคมแบบเรียลไทม์ ไม่ต้องเทรนโมเดลเอง

ออกแบบมาเพื่อกลุ่มผู้สูงอายุ ผู้ป่วยพักฟื้นหลังผ่าตัดมือ/ข้อมือ หรือผู้ป่วย Parkinson ที่ต้องฝึก fine motor skills ของนิ้วมืออย่างสม่ำเสมอ

> **ข้อจำกัดความรับผิดชอบ:** เครื่องมือนี้ใช้เพื่อการติดตามและกระตุ้นการออกกำลังกายเบื้องต้นเท่านั้น **ไม่ใช่เครื่องมือวินิจฉัยทางการแพทย์** ควรปรึกษาแพทย์หรือนักกายภาพบำบัดสำหรับการประเมินที่แม่นยำ

## Assignment
- วิชา: DT508 Machine Learning
- โจทย์: Assignment 6 - Smart Medical or Wellness Technology
- เทคโนโลยีหลัก: TensorFlow.js (ผ่าน MediaPipe Hands), HTML5 Canvas, JavaScript

## แนวคิด

### โหมด A: Assessment / Tracker
ตรวจจับมือ 1 ข้าง วัดระยะห่างเฉลี่ยระหว่างปลายนิ้ว (index, middle, ring, pinky) กับข้อมือ (wrist) เพื่อจำแนกสถานะ "กำมือ" (CLOSED) และ "แบมือ" (OPEN) แบบ state machine พร้อม hysteresis กันการนับซ้ำ

**Normalize ระยะทาง:** เพื่อไม่ให้ threshold ผันผวนตามระยะห่างจากกล้องหรือขนาดมือของแต่ละคน ให้หารระยะ fingertip-to-wrist ด้วยระยะอ้างอิง (เช่น wrist → middle_finger_mcp, landmark 0 → 9) ก่อนเทียบ threshold:

```
normalizedDist = dist(fingertip, wrist) / dist(middle_mcp, wrist)
```

**Threshold เริ่มต้น (ปรับได้ตามการทดลองจริง):**
- `CLOSED`: normalizedDist เฉลี่ย 4 นิ้ว < **0.9**
- `OPEN`: normalizedDist เฉลี่ย 4 นิ้ว > **1.3**
- ช่วงกลาง (0.9–1.3) ถือเป็น transition zone ไม่เปลี่ยน state (กัน false trigger / hysteresis)

วัดผลได้ 3 อย่าง:
- **จำนวนครั้ง (reps)** - นับ 1 ครั้งเมื่อ state เปลี่ยนครบรอบ OPEN → CLOSED → OPEN
- **ความเร็วเฉลี่ยต่อครั้ง (วินาที/rep)** - คำนวณจากผลต่างของ `performance.now()` ระหว่าง OPEN state สองครั้งที่ติดกัน บ่งชี้ bradykinesia / การเคลื่อนไหวช้าลง หากค่าเฉลี่ยเพิ่มขึ้นต่อเนื่องในเซสชันเดียวกัน
- **ความสม่ำเสมอของระยะ (variance)** - เก็บ normalizedDist ทุกเฟรมระหว่างช่วง "แบมือค้าง" (state = OPEN ต่อเนื่อง ≥ 1 วินาที) แล้วคำนวณ variance จาก sliding window ล่าสุด 30 เฟรม (~1 วินาทีที่ 30fps) บ่งชี้อาการมือสั่น / tremor คร่าวๆ

**เกณฑ์ประเมินผล (สำหรับตรวจสอบความแม่นยำ):** เทียบจำนวน reps ที่ระบบนับได้ กับการนับด้วยสายตาจากวิดีโอย้อนหลัง (manual count) อย่างน้อย 3 เซสชัน ยอมรับความคลาดเคลื่อนไม่เกิน ±1 rep ต่อ 10 ครั้ง

### โหมด B: Interactive Game
เกมกระตุ้นให้ฝึกต่อเนื่องแบบสนุก ต่อยอด logic จากเกม Space Shooter (Lecture 12) โดยเปลี่ยนจาก "ระยะห่างสองมือ = ยิง" เป็น "กำมือ = เก็บของ/ทำลายเป้า" ด้วยมือข้างเดียว

**กติกาเบื้องต้น:**
- วัตถุ (เช่นวงกลม/ไอคอนผลไม้) ตกลงมาแบบสุ่มตำแหน่งจากขอบบนจอ ด้วยความเร็วคงที่
- ตำแหน่งมือ (wrist หรือ palm center) ควบคุมตัวรับ (basket/paddle) ให้เคลื่อนที่ตามแนวนอน
- เมื่อวัตถุตกถึงตำแหน่งตัวรับ **และ** ผู้เล่นกำมือ (state = CLOSED) ในจังหวะนั้น → นับ +1 คะแนน และลบวัตถุออก
- พลาด (วัตถุตกพ้นจอโดยไม่ได้กำมือ) → ไม่หักคะแนน แต่แสดง feedback เพื่อกระตุ้นให้ลองใหม่
- จบเกมเมื่อครบเวลาที่ตั้งไว้ (ค่าเริ่มต้น 60 วินาที) แสดงคะแนนรวมและจำนวนครั้งที่กำมือสำเร็จ

### โหมด C: Finger Tapping (Parkinson's screening)
อ้างอิงท่า **finger tapping** ซึ่งเป็นส่วนหนึ่งของ UPDRS motor exam ที่ใช้ตรวจ Parkinson's จริงในคลินิก ให้แตะปลายนิ้วโป้ง (thumb tip, landmark 4) กับปลายนิ้วชี้ (index tip, landmark 8) สลับเปิด-ปิดให้เร็วและกว้างที่สุดเท่าที่ทำได้ ต่อเนื่อง 10-15 วินาที

**Normalize ระยะทาง:** ใช้สูตรเดียวกับโหมด A แต่เปลี่ยนคู่ landmark เป็น thumb tip ↔ index tip แล้วหารด้วยระยะอ้างอิง wrist → middle_mcp (landmark 0 → 9):

```
tapDist = dist(thumb_tip, index_tip) / dist(middle_mcp, wrist)
```

**Threshold เริ่มต้น (ปรับได้ตามการทดลองจริง):**
- `CLOSED` (นิ้วชนกัน): tapDist < **0.3**
- `OPEN` (กางนิ้วสุด): tapDist > **0.8**
- ช่วงกลาง (0.3–0.8) เป็น transition zone เหมือนโหมด A

วัดผลได้ 3 อย่าง (นอกเหนือจาก reps ที่นับแบบเดียวกับโหมด A):
- **Amplitude ต่อ tap** - ค่า tapDist สูงสุดที่ทำได้ในแต่ละรอบ CLOSED→OPEN (ยิ่งกางนิ้วได้กว้างยิ่งดี)
- **Decrement (%)** - เปรียบเทียบ amplitude เฉลี่ยของ 3 tap แรก กับ 3 tap สุดท้ายในเซสชัน `decrement = (amplitude_first3_avg - amplitude_last3_avg) / amplitude_first3_avg * 100` ค่ายิ่งสูง (amplitude ลดลงเรื่อยๆ) ยิ่งเป็นสัญญาณเฉพาะของ Parkinson's มากกว่าความช้าเฉยๆ
- **Rhythm irregularity (CV)** - coefficient of variation ของช่วงเวลาระหว่างแต่ละ tap `CV = SD(interTapIntervals) / mean(interTapIntervals)` ค่ายิ่งสูงยิ่งบ่งชี้จังหวะที่ไม่สม่ำเสมอ

**เกณฑ์ประเมินผล:** เทียบ amplitude และจำนวน tap ที่ระบบนับได้กับวิดีโอย้อนหลัง (manual count) อย่างน้อย 3 เซสชัน ยอมรับความคลาดเคลื่อนไม่เกิน ±1 tap ต่อ 10 ครั้ง เช่นเดียวกับโหมด A

## โครงสร้างโปรเจกต์

```
hand-exercise-tracker/
├── index.html      # โหลด MediaPipe Hands + Camera Utils ผ่าน CDN
├── style.css        # เลย์เอาต์แบ่งจอ camera / content
├── app.js            # core logic: setup MediaPipe, onResults, state machine, mode switching
├── images/           # asset สำหรับเกม (ถ้ามี)
└── README.md
```

## เทคนิคหลักที่ใช้

- **MediaPipe Hands** (`@mediapipe/hands`, `@mediapipe/camera_utils`) สำหรับตรวจจับ 21 landmark ของมือแบบเรียลไทม์
- **State machine (OPEN/CLOSED)** พร้อม threshold 2 ค่าเพื่อกัน false trigger จากมือสั่นเล็กน้อย
- **HTML5 Canvas** สำหรับวาดผลลัพธ์และ UI ของเกม
- คำนวณระยะทางด้วย `Math.hypot()` ระหว่าง landmark ปลายนิ้วกับข้อมือ (landmark index 0)

## วิธีรัน

1. เปิดโปรเจกต์ด้วย VS Code
2. ใช้ Extension **Live Server** คลิกขวาที่ `index.html` → Open with Live Server
3. อนุญาตการเข้าถึงกล้อง (webcam) เมื่อเบราว์เซอร์ขอสิทธิ์
4. เลือกโหมด Assessment หรือ Game จากหน้าแอป

## Roadmap (สิ่งที่จะทำต่อ)

- [x] สร้าง `index.html` + `style.css` (เลย์เอาต์ + โหลดไลบรารี)
- [x] เขียน `app.js`: setup MediaPipe Hands, กล้อง, canvas
- [x] Implement state machine ตรวจจับกำ-แบมือ + นับ reps
- [x] คำนวณสถิติ (ความเร็วเฉลี่ย, variance) และแสดงผลสรุปเซสชัน
- [x] Implement โหมดเกม (เก็บของด้วยการกำมือ)
- [x] ใส่ disclaimer ทางการแพทย์ในหน้า UI
- [x] Implement โหมด Finger Tapping (thumb-index) + decrement + rhythm irregularity
- [ ] ทดสอบ/ปรับ threshold (CLOSED/OPEN) กับมือและระยะกล้องจริง ทุกโหมด
- [ ] ตรวจสอบความแม่นยำการนับ reps/tap เทียบกับ manual count (ตามเกณฑ์ใน README)
