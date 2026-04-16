# QR-Guard — Chapter-by-Chapter Concept Mapping

**Project:** QR-Guard — Location-Based QR Attendance System  
**Course:** CSIS 330 — Software Engineering, Dr. Aaron Rababaah, AUK  
**Purpose:** Maps every relevant concept from Ch01–Ch09 + Ch23 to QR-Guard design decisions.

---

## Ch01 — Introduction

### Software Type
**Customized product** (slide 15–16). The specification is owned by the client (AUK / Dr. Rababaah), not the dev team. Decisions on changes are made by the client. This is not a generic product sold to any customer.

### Application Type
**Interactive transaction-based** (slide 21). Executes on a remote server, accessed by users from smartphones/laptops. Each QR scan is a real-time transaction: scan → validate → record → respond.

Secondary classification: **Data collection system** (slide 23). Collects GPS coordinates and timestamps from student devices and sends that data to the server for processing.

### Essential Attributes (slide 17)

| Attribute | QR-Guard Design Decision |
|-----------|--------------------------|
| Maintainability | MVC architecture. SOLID principles. Modular increments allow isolated component updates. |
| Dependability (Reliability + Security + Safety) | HTTPS, bcrypt (12 rounds), 6-layer anti-fraud (dynamic QR, GPS geofence, device binding via FingerprintJS, IP country check via ip-api.com, GPS accuracy validation, audit logging). No single point of failure for attendance data (local queue + server sync). |
| Efficiency | QR verification < 3 sec. WebSocket push (no polling). Lightweight web interface — no native app overhead. |
| Acceptability | ≤ 2 taps login-to-scan. Any mobile browser. Zero installation. Mobile-first responsive UI. |

### Software Process Activities — SDIVE (slide 18)

| Activity | QR-Guard |
|----------|----------|
| Specification | FRS document. Requirements refined at start of each increment. |
| Design | UML models: context, use case, sequence, activity, state machine, class, architecture. |
| Implementation | Code per increment. Frontend + backend + DB in parallel within each increment. |
| Verification & Validation | Unit tests + code review (verification). Prototype demo Inc 3, beta Inc 5 (validation). |
| Evolution | Not during semester. But system designed for it: MVC, configurable thresholds, modular increments. |

### Verification vs Validation (slide 13)

| | QR-Guard |
|---|----------|
| Verification ("built it right") | Code inspections, unit tests, RTM completeness checks — does implementation match the FRS? |
| Validation ("built the right thing") | QR scanning prototype demo (Inc 3), beta test with real course section, acceptance testing with Dr. Rababaah — does it solve AUK's attendance problem? |

### QA vs QC (slide 14)

| | QR-Guard |
|---|----------|
| QA (process, proactive, defect prevention) | Incremental delivery with peer reviews after each increment. RTM maintained to ensure every requirement has a design artifact and test case. Code reviews before merges. |
| QC (product, reactive, defect detection) | Unit testing GPS boundary logic, QR encode/decode. Integration testing scan pipeline. Black-box testing REST endpoints. Manual testing per increment. |

### ACM/IEEE Ethics (slides 30–31)

| Principle | Application |
|-----------|-------------|
| 1 — PUBLIC | GPS collected only during active scan, never continuous tracking. No biometric data stored. Student privacy respected. |
| 2 — CLIENT & EMPLOYER | Enforces AUK's 15% absence policy as client requires. Attendance data accurate and tamper-evident. |
| 3 — PRODUCT | Anti-fraud measures (dynamic QR, geofencing, device binding) ensure data integrity. |
| 7 — COLLEAGUES | Known limitations documented honestly. No overclaiming capabilities. |
| 8 — SELF | Team learning WebSocket, Geolocation API, browser fingerprinting — lifelong learning. |

### Professional Responsibility (slides 26–27)

| Issue | QR-Guard |
|-------|----------|
| Confidentiality | Attendance records accessible only to enrolled instructor and individual student. No cross-course data leakage. |
| Competence | Team prototypes the QR/GPS pipeline in Inc 3 because that's the area with least experience — acknowledging competence boundaries. |
| Intellectual property | Open-source libraries (qrcode.js, bcrypt, Express/Flask) used with appropriate licenses. |
| Computer misuse | System prevents misuse of attendance data. Audit log ensures accountability. |

### Ethical Dilemmas (slide 33)
GPS location tracking raises a privacy dilemma: the system needs location data to prevent fraud, but collecting location data on students is sensitive. Resolution: GPS is collected only at the moment of scanning (not continuous), coordinates are stored only as part of the attendance record, and the system does not track movement patterns.

### Case Study Parallel — Mentcare (slides 40–45)
Both QR-Guard and Mentcare are information systems managing sensitive personal records with multiple user roles and centralized databases accessed from multiple locations. Mentcare has patient data privacy concerns; QR-Guard has student location data privacy concerns. Mentcare monitors for dangerous patients; QR-Guard monitors for at-risk attendance levels. Both require high availability during operating hours.

---

## Ch02 — Software Processes

### Process Model — Incremental (slides 9, 29–31)

Originally proposed Waterfall in PR1. Updated to **Incremental** for PR2.

| Model | Why NOT for QR-Guard |
|-------|----------------------|
| Waterfall | Can't test QR/GPS pipeline until everything is built. If GPS doesn't work indoors, discovered too late. Slide 28: "difficulty of accommodating change after the process is underway." |
| Iterative | Entire system at low fidelity each iteration. 6 people, 14 weeks — spreading across all features means nothing is demo-ready until late. |
| Pure Agile | Requires constant communication across all features. Fixed academic deadline + parallel team layers = too much coordination overhead. |
| Integration & Config (COTS) | No existing system meets AUK's specific needs (dynamic QR + geofencing + device binding + AUK policy). Core is built from scratch; some components reused (qrcode.js, bcrypt, Geolocation API). |

**Why Incremental:**
- Slide 30: "easier to get customer feedback" — Dr. Rababaah reviews via progress reports.
- Slide 30: "more rapid delivery of useful software" — working scan pipeline by week 10.
- Slide 31 (problem: "process not visible") — mitigated by RTM and increment milestone table.

### 3D Slicing Model (slides 18–25)
Incremental = **feature dimension**. Each increment delivers a subset of features at full fidelity. Not layer-by-layer (Waterfall), not all features at partial fidelity (Iterative).

### Plan-Driven vs Agile Hybrid (slide 7)

| Aspect | Plan-Driven | Agile |
|--------|-------------|-------|
| Schedule | 5 increments, fixed weeks | Scope within each increment flexible |
| Architecture | MVC + Client-Server upfront | Implementation details evolve |
| Documentation | FRS, RTM, progress reports | Lightweight — no full SRS per increment |
| Feedback | Progress report reviews | Prototype demos, beta testing |
| Testing | Strategy in RTM | Tests written alongside code |

### Incremental Delivery Plan

| Inc | Features | Weeks | Milestone |
|-----|----------|-------|-----------|
| 1 | Registration, login, dashboards, email verification, device binding | 3–5 | Auth works |
| 2 | Course CRUD, enrollment codes, geofence config | 5–7 | Courses configured |
| 3 | Dynamic QR (WebSocket), camera scanning, GPS, full verification pipeline | 7–10 | End-to-end attendance |
| 4 | Reports, % calculation, CSV export, real-time dashboard | 10–11 | Data viewable |
| 5 | Email warnings, manual override, audit log, hardening | 11–12 | Feature-complete |
| — | System testing, release testing, UAT, demo prep | 12–14 | Submission |

### POC → Prototype → MVP (slides 58–59)

| Stage | QR-Guard | When | Who |
|-------|----------|------|-----|
| POC | Can browser Geolocation API give accurate GPS inside AUK classrooms? Can camera scan QR from projected screen at 3+ m? | Week 6–7 | Team only |
| Prototype | Working scan pipeline: generate → scan → validate → record. No reports/email yet. | Week 8–9 | Team + Dr. Rababaah |
| MVP | Inc 1–3 complete. Auth + courses + full scan pipeline. Smallest solution delivering core value. | Week 10 | Beta users |

### Coping with Change (slides 51–53)

| Strategy | Application |
|----------|-------------|
| Change anticipation (prototyping) | QR/GPS prototype in Inc 3. Configurable thresholds (geofence radius, QR refresh, warning %) anticipate parameter tuning. |
| Change tolerance (incremental) | Each increment self-contained. If geofence requirements change after Inc 2, only Inc 2 modified. |

### Emergent Properties (slides 45–46)

| Property | How it emerges |
|----------|----------------|
| Reliability | QR gen + GPS check + device binding + WebSocket must all work within a 25-sec window. Only testable after integration (Inc 3). |
| Security | All 6 layers (dynamic QR, geofencing, device binding, IP check, GPS accuracy, audit log) are each insufficient alone. Security emerges only when all six interact correctly. |
| Usability | ≤ 2 taps depends on camera prompt + GPS prompt + session persistence + scanner initialization across devices. |
| Performance | 60 concurrent scans depends on server, DB writes, WebSocket connections, and network all under simultaneous load. |

### Process Metrics (slides 64–66)

| Metric | Measurement |
|--------|-------------|
| Cycle time | Weeks per increment. Target: 2–3 weeks. |
| Velocity | FRs delivered per increment. Baseline after Inc 1. |
| WIP | Open tasks in progress. Max 2 per person. |
| Defects | Bug count per increment. Watch for increase as complexity grows (Lehman's Law 2, Ch09). |

### CASE Tools (slide 56)

| Category | Tool |
|----------|------|
| UML | StarUML |
| Project management | GitHub Projects or Trello |
| Documentation | Google Docs, Word |
| IDE | VS Code |
| Version control | Git + GitHub |
| Testing | Manual per increment, documented against RTM |
| Prototyping | Browser dev tools + mobile live preview |

### CMM Level (slide 67)
Team operates at **Level 2 — Repeatable**. Partially defined process (incremental plan, RTM, FRS) but application may be inconsistent across 6 members. Goal: approach **Level 3 — Defined** by semester end.

### Throw-away Prototype (slide 57)
The QR scanning POC from week 6–7 is a **throw-away prototype**. Focuses on functional validation (does the camera scan work? does GPS resolve indoors?) without non-functional concerns (security, reliability). Will be rebuilt properly in Inc 3 implementation.

---

## Ch04 — Requirements Engineering

### User vs System Requirements (slide 2)

| Level | Example |
|-------|---------|
| User requirement | "Students scan a QR code to mark attendance" — natural language, for stakeholders. |
| System requirement | "FR4.3: The system shall verify the student's GPS location falls within the defined geofence (radius + 15 m indoor margin) before recording attendance." — structured, technical, for developers. |

### Feasibility Categories (slide 5)

| Category | Assessment |
|----------|------------|
| Technical | HTML/CSS/JS, Python/Node.js, PostgreSQL within team experience. qrcode.js, Geolocation API, WebSocket — mature tech. |
| Economic | $0. Neon (serverless PostgreSQL + PostGIS, scale-to-zero). Vercel + Railway free tiers. Resend free email. Browser-native GPS/camera. |
| Schedule | 14 weeks, 5 increments + 2-week buffer. Critical path: Inc 3. |
| Operational | Students carry smartphones. AUK has Wi-Fi. No hardware or IT department involvement. |
| Business (need/urgency/value) | Manual attendance wastes class time. QR sharing is a known cheating method. System directly addresses both. |
| Legal/Ethical | GPS only during scan. No biometrics. Encrypted storage. ACM/IEEE compliant. |

### Functional vs Non-Functional (slide 6)

| Type | QR-Guard Examples |
|------|-------------------|
| Functional | FR4.1: scan QR via camera. FR5.1: calculate attendance %. FR6.1: send warning email. |
| Non-functional | N1: scan-to-response ≤ 3 sec (performance). N4: bcrypt 12 rounds (security). N7: ≤ 2 taps login-to-scan (usability). N10: ≥ 99% uptime (reliability). |

### NFR Metrics (slide 11)

| NFR Category | QR-Guard Metric |
|--------------|-----------------|
| Time / Response | ≤ 3 sec scan-to-response |
| Space | PostgreSQL DB — no special storage constraints for class-scale data |
| Usability | ≤ 2 taps (student), ≤ 3 clicks (instructor) |
| Reliability | ≥ 99% uptime during class hours |
| Robustness | Auto-fallback to HTTP polling on WebSocket disconnect. ≤ 60 sec server recovery. |
| Portability | Chrome, Safari, Firefox ≥ 320px. No native app. |

### Structured Specification (slide 22 — FR template)
Applied to FR4 (scan pipeline) in the FRS document with all fields: Function, Inputs, Source, Outputs, Destination, Action, Preconditions, Postconditions, Side Effects.

### Shall / Should / May (slide 19, ISO convention)

| Keyword | Meaning | QR-Guard count |
|---------|---------|----------------|
| Shall | Mandatory for acceptance | ~35 requirements |
| Should | Expected unless infeasible | ~10 requirements |
| May | Optional if time permits | ~2 requirements |

### Requirements Elicitation (slide 12)
Iterative cycle: specify → discover → evaluate → refine. QR-Guard requirements were initially broad (PR1 proposal), then refined through feasibility analysis (GPS testing), research (anti-fraud literature), and course concept application.

### RTM — Three Traceability Types (slide 26)

| Type | QR-Guard Application |
|------|----------------------|
| Source traceability | Each FR linked to stakeholder: Dr. Rababaah (client), AUK policy (regulatory), team (technical). |
| Requirements traceability | Dependency column in RTM: FR4 depends on FR1, FR2, FR3. Change impact analysis: modifying geofence (FR2.6) affects scanning validation (FR4.3). |
| Design traceability | Each FR linked to UML artifacts and test cases in RTM. |

### Requirements Change Management (slide 13)
If requirements change mid-semester: identify problem → analyze impact → check feasibility → implement change if passed → revise FRS and RTM. Incremental model limits blast radius — changes only affect the current or future increment.

### Scenarios (slide 15)

**Scenario: Student scans QR for attendance**
- Starting situation: Instructor has started a QR session. Student is in the classroom with their phone.
- Normal flow: Student opens web app → taps "Scan" → points camera at projected QR → system validates GPS + QR + device → green checkmark → attendance recorded.
- What can go wrong: GPS denied (show permission message), outside geofence (show "Outside classroom area"), QR expired (show "QR expired — wait for refresh"), device mismatch (show "Device not recognized").
- Concurrent activities: Other students scanning simultaneously. Instructor sees live counter updating.
- End state: Attendance recorded with timestamp and GPS. Student sees confirmation on dashboard.

### WBS — Work Breakdown Structure (slide 33)
QR-Guard WBS follows the incremental plan: each increment is a top-level work package, decomposed into frontend/backend/DB/testing sub-tasks.

---

## Ch04-UML — UML Diagrams

### Diagrams needed for QR-Guard (mapped to Ch05 slide 6):

| Diagram | QR-Guard Application |
|---------|----------------------|
| Use Case | All FR groups: Auth, Course Mgmt, QR Session, Scan & Verify, Reports, Email, Override. Actors: Student, Instructor, System (timer/scheduler). |
| Sequence | Key interactions: Login flow, QR lifecycle (generate → refresh → expire), Scan-Verify-Record pipeline, Email warning trigger, Manual override. |
| Activity | Verification pipeline (FR4): decode → validate time → check GPS → check device → spoof check → record or reject. Also: enrollment flow, report generation. |
| State Machine | QR Code states: Idle → Active → Refreshing → Expired → Stopped. Session states: Not Started → Active → Closed. |
| Class | User (Student, Instructor inheritance), Course, Session, Attendance, AuditLog, QRToken. Relationships: composition (Course—Session), aggregation (Course—Student enrollment), association (Session—Attendance). |

### UML Relationships Applied (from UML slides 14–20):

| Relationship | QR-Guard Example |
|--------------|------------------|
| Association | Student ↔ Course (enrollment — many-to-many) |
| Dependency | QRToken --→ Session (QR depends on session existence) |
| Aggregation | Course ◇— Student (students can exist without the course) |
| Composition | Course ◆— Session (sessions cannot exist without the course) |
| Inheritance | User ← Student, User ← Instructor |
| Interface | Diagnosable interface for health check endpoints |

### Sequence Diagram Stereotypes (UML slide 8):
- **Actor**: Student (stick figure)
- **Boundary**: Web UI (browser interface)
- **Control**: Verification Pipeline (backend controller)
- **Entity**: PostgreSQL Database

---

## Ch05 — System Modeling

### System Perspectives (slide 5)

| Perspective | QR-Guard Model |
|-------------|----------------|
| External (context) | DFD Level 0: QR-Guard system as single circle, with Student, Instructor, Email Server, GPS Satellite as external entities. |
| Interaction | Use case diagrams (user ↔ system), Sequence diagrams (component ↔ component). |
| Behavioral | Activity diagram (verification pipeline), State machine (QR code lifecycle, session lifecycle). |
| Structural | Class diagram (User, Course, Session, Attendance, QRToken, AuditLog). |

### Context Model — DFD Level 0 (slides 9–13)

External entities and data flows:
- **Student** → Scan data, GPS coords, registration info → **QR-Guard** → Attendance confirmation, warnings, dashboard data → **Student**
- **Instructor** → Course config, session control, override requests → **QR-Guard** → QR display, reports, CSV, notifications → **Instructor**
- **Email Server** ← Warning emails, verification emails, confirmations ← **QR-Guard**
- **GPS Service** → Student coordinates → **QR-Guard**

### DFD Level 1 — Internal Processes (slides 16–21)

Decompose QR-Guard into internal processes:
1. **Auth Controller** — handles registration, login, email verification, device binding
2. **Course Manager** — course CRUD, enrollment, geofence config
3. **QR Generator** — creates/refreshes dynamic QR codes, manages WebSocket push
4. **Scan Verifier** — decodes QR, validates GPS/time/device/spoof, records attendance
5. **Report Engine** — calculates percentages, generates per-session/per-student reports, CSV export
6. **Notification Service** — threshold monitoring, email dispatch
7. **Override Handler** — manual attendance changes with audit logging

Data stores: **User DB**, **Course DB**, **Attendance DB**, **Audit Log**

### Interaction Models (slides 22–31)

**Use Case Model:** Each FR group maps to use cases. Include/extend relationships:
- "Scan QR" includes "Verify GPS" and "Verify Device"
- "Start Session" includes "Generate QR"
- "Record Attendance" extends with "Send Warning Email" (conditional: if threshold crossed)

**Sequence Diagrams:** One per major interaction. The scan pipeline sequence is the most complex — Student → Browser UI → Backend Controller → GPS Validator → Device Checker → Database → Email Service.

### Behavioral Models (slides 45–56)

**Activity Diagram — Verification Pipeline:**
Start → Decode QR → [Valid?] → Retrieve GPS → [Within geofence?] → Check device → [Bound?] → Check spoof → [Clean?] → Record attendance → End
Each decision diamond has an error path returning a specific rejection message.

**State Machine — QR Code Lifecycle:**
Idle → (instructor starts session) → Active → (25 sec timer) → Refreshing → (new token generated) → Active → ... → (instructor stops / window expires) → Expired → (session closed) → Idle

**State Machine — Session Lifecycle:**
Not Started → (instructor clicks "Start") → Active → (attendance window expires OR instructor stops) → Closed

### Data Flow vs Activity Model (slide 50)

| Aspect | DFD | Activity |
|--------|-----|----------|
| Theme | Relational — data movement | Procedural — control flow |
| Focus | Where data goes | What steps execute |
| QR-Guard use | Context model, showing data between entities | Verification pipeline, showing decision logic |

### Model-Driven Engineering (slides 58–60)
Not directly applicable — QR-Guard is hand-coded, not generated from models. But models serve as design documentation and communication tools with Dr. Rababaah.

---

## Ch06 — Architectural Design

### Architecture Pattern — Client-Server + MVC (slides 16–19, 28–32)

**Client-Server** (slide 28): Students and instructors are clients accessing services on a central web server. Server manages QR generation, GPS validation, attendance storage, email dispatch.

**MVC** (slide 16):
- **Model**: PostgreSQL + PostGIS (geospatial queries, attendance records (attendance records, accounts, courses, audit logs)
- **View**: Responsive HTML/CSS/JS frontend. Instructor dashboard and student scan interface are separate views sharing the same API.
- **Controller**: Node.js/Python backend handling auth, QR lifecycle, GPS verification, email dispatch.

WebSocket for real-time QR refresh. REST API for everything else.

Why NOT other patterns:
- **Repository** (slide 25): Components do communicate directly (scan verifier calls GPS validator calls device checker). Not purely repository-mediated.
- **Pipe-filter** (slide 33): The verification pipeline resembles pipe-filter, but it's embedded within the MVC controller — not the system-level architecture.
- **Layered** (slide 18): MVC is a form of layered architecture. Could argue 3 layers: presentation (View), application logic (Controller), data (Model). But MVC is more precise for this system.

### Architecture and System Characteristics (slide 11)

| Characteristic | Architectural Decision |
|----------------|------------------------|
| Performance | Large-grain Controller handles entire verification pipeline in one request. WebSocket avoids polling overhead. |
| Security | Layered validation: 6 checks (QR freshness, GPS geofence, device fingerprint, IP country/VPN flag, GPS accuracy, audit log) as separate modules within the Controller. Critical data in Model layer only. |
| Safety | Configurable thresholds prevent incorrect policy enforcement. Manual override as safety valve. |
| Availability | Free-tier hosting has cold starts — accepted trade-off. WebSocket fallback to HTTP polling for reliability. |
| Maintainability | MVC = fine-grain separation. Each increment modifies one layer primarily. |

### Architectural Conflicts (slide 12)
**Performance vs Maintainability**: Large components improve performance (one request for full pipeline), small components improve maintainability (separate GPS validator, device checker, etc.). Resolution: pipeline is one Controller endpoint internally composed of modular functions. External granularity is coarse (one API call), internal granularity is fine (separate validation modules).

### Uniqueness of Architectural Models (slide 14)
The architecture model decomposes QR-Guard into structural components (Auth, Course Manager, QR Generator, Scan Verifier, Report Engine, Notification Service, Override Handler) with component-to-component interfaces — distinct from use cases (interactions), classes (code structure), or activities (behavior).

---

## Ch07 — Design & Implementation

### Design Models Recommended Order (slide 3)
1. Requirements ✓ (FRS)
2. Context model (DFD L0) — to produce
3. Use case model — to produce
4. Sequence model — to produce
5. Data flow (DFD L1) — to produce
6. Activity model — to produce
7. Architecture model ✓ (Client-Server + MVC in FRS)
8. Component design — to produce
9. Class structure — to produce

### Make, Buy, or Lease (slides 4–5)

| Factor | Decision |
|--------|----------|
| Core system (scan pipeline, verification) | **Make** — no existing system meets AUK's specific needs |
| QR generation | **Buy** (reuse) — qrcode.js library, open-source |
| Password hashing | **Buy** — bcrypt library |
| GPS | **Buy** — browser Geolocation API (free, built-in) |
| Camera | **Buy** — browser MediaDevices API (free, built-in) |
| Email | **Lease** — Resend free tier (100/day) or Gmail SMTP |
| Hosting | **Lease** — Vercel + Railway free tiers |
| Database | **Make** — PostgreSQL schema with PostGIS extension for native geofence queries |

### Object Class Identification (slides 12–13)

**Grammatical approach** (nouns = objects, verbs = operations):
- Nouns: Student, Instructor, Course, Session, QRToken, Attendance, AuditLog, Geofence, Device, Email, Report
- Verbs: register, login, create course, enroll, generate QR, scan, verify GPS, verify device, record attendance, calculate percentage, send warning, override

**Tangible things approach:**
- Physical: smartphone (device), classroom (geofence location)
- Roles: Student, Instructor
- Events: scan, session start/stop, threshold crossing
- Interactions: enrollment, attendance recording, override
- Locations: classroom (geofence)

### Interface Specification (slides 17–18)
Object interfaces hide internal representation (slide 17): GPS validator exposes `isWithinGeofence(lat, lng, geofence)` — caller doesn't know if it uses haversine formula, ray-casting, or simple radius check. QR encoder exposes `generateToken(sessionId, timestamp, geofence)` — internal encoding could change from Base64 to JWT without affecting callers.

### Reuse Levels (slide 21)

| Level | QR-Guard |
|-------|----------|
| Abstraction | MVC pattern, Client-Server pattern, anti-fraud research |
| Object | bcrypt, qrcode.js, Geolocation API, WebSocket library |
| Component | Express/Flask framework, Nodemailer/Resend email SDK |
| System | No full system reuse — core is built from scratch |

### Configuration Management (slide 24)

| Activity | QR-Guard |
|----------|----------|
| Version management | Git + GitHub. Branching per increment. |
| System integration | Each increment merged to main after testing. |
| Problem tracking | GitHub Issues. Bugs tagged by increment. |
| Release management | Inc 1–5 are internal releases. Final demo is the release. |

### Version Scheme (slide 25)
v0.1.0.0 → v0.2.0.0 → v0.3.0.0 → v0.4.0.0 → v0.5.0.0 → v1.0.0.0 (demo)

Phase 0 = alpha (within team) for all increments. Phase 1 = beta for Inc 5 pilot test. Phase 3 = final release at demo.

### Host-Target Development (slides 26–27)
- **Host** (development): team laptops, VS Code, local Node/Python, SQLite for dev
- **Target** (deployment): Vercel (frontend), Railway/Render (backend), Neon (PostgreSQL + PostGIS, serverless), free-tier cloud

### Open Source Licensing (slides 31–33)
All dependencies are permissively licensed (MIT, Apache 2.0, BSD). QR-Guard itself is academic — no public release planned. No GPL components that would force open-sourcing.

### SOLID Principles (slide 36)

| Principle | QR-Guard Application |
|-----------|----------------------|
| Single Responsibility | GPS validator only validates GPS. QR generator only generates QR. Email service only sends email. |
| Open/Closed | Verification pipeline: can add new checks (e.g., Wi-Fi SSID verification) without modifying existing GPS/device checks. |
| Liskov Substitution | Student and Instructor both extend User. Any code expecting a User works with either subclass. |
| Interface Segregation | Instructor dashboard API and Student scan API are separate interfaces — students don't need report endpoints, instructors don't need scan endpoints. |
| Dependency Inversion | Verification pipeline depends on abstractions (ValidatorInterface) not concrete implementations. Can swap GPS validator for Wi-Fi validator without changing pipeline. |

### Design Smells (slides 34–35)

| Smell | How QR-Guard avoids it |
|-------|------------------------|
| Rigidity | MVC + modular validation functions. Changing GPS logic doesn't affect QR generation. |
| Fragility | Each validator is independent. Modifying device check can't break GPS check. |
| Immobility | Validators are reusable functions, not tightly coupled to one controller. |
| Viscosity | Incremental plan + clear architecture makes "doing it right" not harder than hacking. |
| Opacity | Consistent naming, single responsibility, structured FRS as documentation. |
| Complexity | No over-engineering. Simple radius geofence, not polygon ray-casting (unless needed). |
| Singularity | Validation logic centralized in pipeline, not duplicated across endpoints. |

### Simulation vs Emulation (slide 30)
GPS testing uses **simulation** — mock GPS coordinates injected during unit tests to simulate inside/outside/boundary scenarios. Not emulating real GPS hardware.

---

## Ch08 — Testing

### Testing Objectives (slide 3)
- Functional: show the scan pipeline does what it's supposed to do.
- Non-functional: verify ≤ 3 sec response, ≥ 60 concurrent, ≥ 99% uptime.
- Errors: discover defects before demo.

### Testing Stages (slide 22)

| Stage | QR-Guard | Who |
|-------|----------|-----|
| Development testing | Unit tests (GPS boundary, QR encode/decode, % calc, bcrypt). Component tests (auth + device binding). | Dev team |
| Release testing | Full pipeline test. Performance (60 concurrent). Stress test to find limits. Requirements-based: every FR mapped via RTM. | Testing role within team |
| User testing | Alpha (team on campus), Beta (pilot course), Acceptance (Dr. Rababaah demo). | Users + client |

### Development Testing Breakdown (slide 23)

| Level | QR-Guard |
|-------|----------|
| Unit testing | Individual functions: `isWithinGeofence()`, `generateQRToken()`, `calculatePercentage()`, `verifyBcrypt()` |
| Component testing | Auth module (login + device binding + session management integrated). Scan module (QR decode + GPS + device + spoof integrated). |
| System testing | Full pipeline: student logs in → scans QR → attendance recorded → report shows updated %. Tests emergent properties. |

### Partition Testing (slides 29–32)

| Input | Partitions |
|-------|------------|
| GPS coordinates | Inside geofence, outside geofence, exactly on boundary, null (permission denied), accuracy=0 (spoofed), accuracy>150 (unreliable) |
| QR token timestamp | Current (valid), expired (previous cycle), future (clock skew), malformed |
| Device fingerprint | Registered device, unregistered device, null, changed fingerprint |
| Client IP | Kuwait ISP, foreign IP, VPN/proxy flagged, datacenter IP, Tor exit node |
| Login credentials | Valid email+password, valid email+wrong password, unregistered email, locked account |
| Attendance percentage | 0% (no sessions), 100%, exactly at threshold (85%), below threshold, above threshold |
| Enrollment code | Valid code, invalid code, already enrolled, code for wrong section |

### Black-Box vs White-Box (slides 33–34)
- **Black-box**: Test REST API endpoints with valid/invalid inputs without knowing implementation. Does `/api/scan` return 200 with valid data and 403 with bad GPS?
- **White-box**: Examine GPS validation code to find additional partitions. If the code has a special case for null coordinates, add a test for that.

### Mock Objects (slide 26)
- **Mock GPS**: Returns predetermined coordinates during testing. Avoids needing real GPS hardware.
- **Mock Email**: Captures email content without actually sending. Verifies warning email contains correct student name, course, percentage.
- **Mock Database**: In-memory store for unit tests. Avoids slow DB setup.

### Interface Testing (slides 37–41)

| Interface Type | QR-Guard Example |
|----------------|------------------|
| Parameter | Frontend calls `POST /api/scan` with `{qr_payload, gps_lat, gps_lng, device_id}`. Test: wrong parameter order, missing fields, wrong types. |
| Shared memory | Not applicable (no shared memory interfaces). |
| Procedural | Backend modules: scan controller calls GPS validator, device checker, QR decoder. Test each sub-interface. |
| Message passing | WebSocket: server pushes new QR to instructor client. Test: connection drop, reconnect, stale message handling. |

### Interface Errors (slide 40)
- **Misuse**: Frontend sends GPS as strings instead of floats.
- **Misunderstanding**: Frontend assumes scan endpoint returns attendance ID, but it returns confirmation message.
- **Timing**: WebSocket QR refresh arrives after student already scanned old QR — race condition.

### TDD Approach (slides 45–47)
Not strictly TDD (no time for full TDD in 14 weeks), but TDD-influenced: tests written for each increment alongside code. Regression suite grows with each increment.

Benefits applied:
- Code coverage: every FR has at least one test.
- Regression: previous increment tests re-run after new increment.
- Simplified debugging: failing test pinpoints the new code.

### Performance Testing (slides 51–52)

**Operational profile**: 85% of transactions are QR scans, 10% are report views, 5% are admin operations (course management, overrides). Test load reflects this distribution.

**Stress testing**: Increase concurrent scans beyond 60 to find degradation point. Discover when response time exceeds 3 sec threshold.

### User Testing Types (slide 54)

| Type | QR-Guard |
|------|----------|
| Alpha | Team members test on AUK campus with real devices. Internal, controlled. |
| Beta | Pilot with one real course section. Students and instructor use the system for actual attendance. |
| Acceptance | Dr. Rababaah evaluates against requirements in final demo. |

### Inspection Process (slides 19–21)
Code reviews after each increment. Team members exchange roles — frontend dev reviews backend code, backend dev reviews frontend. Fresh eyes catch errors the author misses (slide 19: "errors can mask other errors" in testing, but not in inspection).

### Output vs Outcome (slide 57)

| | QR-Guard |
|---|----------|
| Output | Working attendance system with QR scanning, GPS verification, reports, emails. |
| Outcome | Students stop cheating attendance. Instructors save time. Accurate attendance data for AUK policy enforcement. |

---

## Ch09 — Software Evolution

### Software Change Drivers (slide 3)
QR-Guard will face change after deployment:
- New requirements: instructor wants per-building geofences, admin role, API for LMS integration
- Environment changes: browser API updates, hosting provider changes
- Error repair: GPS edge cases, WebSocket reliability issues
- Performance improvement: optimize for larger class sizes

### Evolution Cost (slide 4)
Majority of software budget goes to evolution, not development. QR-Guard is designed for this: MVC, configurable thresholds, modular validators — changes are localized.

### Phases After Delivery (slide 9)

| Phase | QR-Guard Scenario |
|-------|-------------------|
| Evolution | Post-semester: AUK adopts system, new features added (admin panel, LMS integration, multi-campus support). |
| Servicing | No new features. Only bug fixes and environment updates (new browser versions, hosting changes). |
| Phase-out | AUK replaces with a commercial system. Data exported, system decommissioned. |

### Maintenance Types (slide 43)

| Type | QR-Guard Example |
|------|------------------|
| Corrective | Fix: GPS boundary check fails when device returns coordinates with only 4 decimal places instead of 6. |
| Adaptive | Update: new Chrome version deprecates a Geolocation API method. Adapt code to use replacement. |
| Perfective | Improve: add per-building geofences (new requirement). Optimize scan pipeline for 200 concurrent users. |
| Preventive | Proactive: add database indexes before performance degrades. Update dependencies before security vulnerabilities are discovered. |

### Legacy System Considerations (slides 17–18)
Not applicable during initial development. But if QR-Guard is used for several years, it could become a legacy system with: outdated frontend framework, dependencies on deprecated APIs, knowledge loss as original team graduates.

### Value-Quality Matrix (slide 29)
QR-Guard should aim for **high quality + high business value** quadrant (continue maintaining). Design decisions (MVC, SOLID, audit logs, configurable thresholds) are investments in staying in that quadrant.

### Lehman's Laws (slides 46–47) — relevant ones:

| Law | QR-Guard Implication |
|-----|----------------------|
| 1 — Continuing Change | Must keep updating GPS validation as spoofing techniques evolve. Must adapt to new browser APIs. |
| 2 — Increasing Complexity | Each new feature (admin panel, LMS integration) increases complexity unless refactored. MVC and modular design slow this. |
| 5 — Conservation of Familiarity | If original team leaves (graduation), new maintainers need documentation. FRS + UML models serve this purpose. |
| 7 — Declining Quality | Without maintenance investment, QR-Guard's quality will degrade. Technical debt from Inc 3 (if prototype code isn't properly refactored) compounds. |

### Technical Debt (slide 48)

| Type | QR-Guard Risk |
|------|---------------|
| Intentional | Rushed prototype in Inc 3 if GPS testing runs long. Debt repaid in Inc 5 hardening phase. |
| Unintentional | Team inexperience with WebSocket may produce suboptimal implementation. |
| Environmental | Free-tier hosting may change terms. Browser APIs may deprecate. |
| Bit rot | If AUK uses system for 3+ years without updates, dependencies become outdated. |

### Refactoring Techniques (slide 53)
Applied during Inc 5 hardening: fix duplicate validation logic, split complex scan pipeline if it's grown too large, extract common patterns from endpoint handlers, ensure consistent error handling.

### Bad Smells (slides 54–55)
Watch for during development: duplicate GPS validation code in multiple endpoints (centralize), long verification pipeline method (split into sub-functions), data clumping (lat/lng/radius always passed together — create Geofence object).

---

## Ch23 — Project Planning

### Project Plan Sections (slide 4)
QR-Guard project plan includes: introduction (FRS §1), project organization (team roles in PR1), risk analysis (below), resource requirements ($0), work breakdown (increment plan), schedule (Gantt chart), monitoring (progress reports).

### SWOT Analysis (slide 13)

| | Positive | Negative |
|---|----------|----------|
| Internal | **Strengths**: Team has web dev experience. Free tech stack. Well-defined requirements. Browser-native APIs (no hardware). | **Weaknesses**: No prior WebSocket/GPS experience. 6-person coordination overhead. No automated testing infrastructure. |
| External | **Opportunities**: AUK has real need for attendance automation. If successful, could be adopted university-wide. | **Threats**: Indoor GPS unreliability. Free-tier hosting limitations. Browser API changes. Short 14-week timeline. |

### Risk Analysis (from slide 6)

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Indoor GPS inaccuracy | High | High | +15 m margin. Prototype in Inc 3. Manual override fallback. |
| WebSocket unreliability on mobile | Medium | Medium | HTTP polling fallback (FR3.3). |
| Free-tier hosting cold starts | High | Low | Acceptable for class scale. Upgrade path exists. |
| Team member drops course | Low | High | Documentation + modular increments = anyone can pick up any module. |
| Scope creep | Medium | Medium | FRS locked after PR2. Changes go through change management (Ch04). |
| Browser API deprecation | Low | Medium | Standard APIs (Geolocation, MediaDevices) — stable for years. |

### COCOMO Estimation — Application Composition Model (slides 26–28)

**NAP (Number of Application Points):**

| Component | Count |
|-----------|-------|
| Screens/pages | 8 (login, register, student dashboard, instructor dashboard, scan page, course management, reports, session control) |
| Reports | 3 (per-session, per-student, CSV export) |
| Modules (backend) | 7 (auth, courses, QR generator, scan verifier, reports, notifications, overrides) |
| Script files (frontend JS) | 6 (auth, scan, dashboard, reports, websocket, utils) |
| Database tables | 7 (users, courses, enrollments, sessions, attendance, audit_log, qr_tokens) + PostGIS spatial indexes |

**NAP = 8 + 3 + 7 + 6 + 7 = 31**

- %REUSE = 30% (bcrypt, qrcode.js, Geolocation API, WebSocket library, email SDK)
- PROD = 7 (Low — student team, first time with this stack combination)

**PM = (31 × (1 - 0.30)) / 7 = 3.1 person-months**

**TDEV = 3 × (3.1)^(0.33 + 0.2 × (1.17 - 1.01)) = 4.5 months**

With 6 team members over ~3.5 months (14 weeks): 6 × 3.5 = 21 person-months available. 3.1 PM required. Feasible with significant margin for learning curve and coordination overhead.

### Exponent B Calculation (slide 46)

| Factor | Rating | Value |
|--------|--------|-------|
| Precedentedness | Low (new to team) | 4 |
| Development flexibility | High (academic project, client flexible) | 2 |
| Architecture/risk resolution | Nominal (some prototyping planned) | 3 |
| Team cohesion | Nominal (classmates, not experienced team) | 3 |
| Process maturity | Low (CMM Level 2) | 4 |

**B = (4 + 2 + 3 + 3 + 4) / 100 + 1.01 = 1.17**

### Gantt Chart Tasks (slide 16–17)

| Task | Effort | Duration | Dependencies |
|------|--------|----------|--------------|
| T1: FRS + RTM | 3 person-days | Week 1–2 | — |
| T2: UML models | 5 person-days | Week 2–3 | T1 |
| T3: Auth implementation (Inc 1) | 8 person-days | Week 3–5 | T2 |
| T4: Course management (Inc 2) | 6 person-days | Week 5–7 | T3 |
| T5: QR/GPS prototype (POC) | 3 person-days | Week 6–7 | T2 |
| T6: Scan pipeline (Inc 3) | 12 person-days | Week 7–10 | T4, T5 |
| T7: Reports (Inc 4) | 5 person-days | Week 10–11 | T6 |
| T8: Email + Override (Inc 5) | 5 person-days | Week 11–12 | T6 |
| T9: System + Release testing | 6 person-days | Week 12–13 | T6, T7, T8 |
| T10: UAT + Demo prep | 3 person-days | Week 13–14 | T9 |

**Critical path**: T1 → T2 → T3 → T4 → T6 → T9 → T10

### Staff Allocation (slide 18)

| Role | Team Members | Focus |
|------|-------------|-------|
| Frontend | 2 members | UI, scan interface, dashboards, WebSocket client |
| Backend | 2 members | API, verification pipeline, QR generation, email |
| Database + DevOps | 1 member | Schema, hosting setup, deployment |
| Documentation + Testing | 1 member | FRS, UML, progress reports, test execution |

Overlap: all members participate in testing during Inc 5 and testing phase. Documentation lead also assists with frontend.

### Business Model (slides 8–11)
QR-Guard is a **freemium model** (if commercialized): basic attendance tracking free, premium features (analytics, LMS integration, multi-campus) paid. For the class project: entirely free, no revenue model.

---

*End of chapter mapping. Every concept from Ch01–Ch09 + Ch23 applied to QR-Guard.*
