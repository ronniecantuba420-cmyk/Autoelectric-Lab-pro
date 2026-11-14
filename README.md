AutoElectric Lab Pro is a professional virtual ECU bench simulation and automotive electronics diagnostics platform.
It is a deterministic, physics-based lab powered by a real Modified Nodal Analysis (MNA) circuit solver. Technicians can power up an ECU, wire sensors/actuators, inject realistic electrical faults, measure with virtual instruments, watch live DTCs appear, and practice diagnostics — all without a physical vehicle or expensive hardware.
Built with React + TypeScript, Three.js, Firebase, and Gemini AI. It is still early (v0.0.0 / enterprise edition branding, 0 stars), but the core architecture is serious and production-oriented.

Core Features Breakdown
1. Virtual ECU Bench Lab (Real-Time Circuit Simulation)
Full power supply control (0–30 V, current limiting, presets: 12 V Bench, 14.4 V Running, 10.2 V Cranking, 5 V Logic)
Default 16-pin ECU model with realistic labels (KL30, KL15, KL31, VREF 5 V, TPS, MAP, ECT, Injector, CAN-H/L, O2, etc.)
Pre-wired sensors (TPS, MAP, ECT) and actuators (Injector, Main Relay, CAN terminator)
Interactive wiring canvas — add/remove/cut wires, change resistance
Live node voltages, currents, and supply current draw calculated every render cycle via MNA solver
2. Digital Multimeter (DMM)
Modes: V DC, V AC, Resistance, Continuity, Frequency, Diode
Red/black probes attachable to any ECU pin, component pad, or chassis ground
Auto-ranging with realistic readings driven by the live circuit solution
3. Fault Injection Matrix
Inject realistic faults on any pin:
Open circuit (broken wire / unseated pin)
Short to Ground (KL31)
Short to Battery (+12 V)
High resistance (50 Ω / 250 Ω / 1 kΩ — simulates corrosion/fretting)
Quick diagnostic scenarios (TPS wire break → P0122, CAN short → U0001, Injector open → P0201, ground corrosion, etc.)
Live OBD-II DTC monitor that automatically generates active codes based on the electrical state
4. Oscilloscope
Live waveform viewing (PWM, injector flyback spikes, crankshaft VR signals, etc.)
5. ECU Connector Pinout Library + OEM Knowledge
Detailed pinout data for real ECUs (strong focus on Toyota/Denso architectures popular in the Philippines and similar markets)
Multiple connector plugs, wire colors, nominal voltages, connection instructions, electrical specs
Essential checklist pins for safe bench power-up
PCB component annotations (CPU, crystal, injector drivers, etc.) with diagnostic roles
6. Schematic / PCB Scanner + AI Track Mapper
Visual inspection of ECU boards
Component identification and net connectivity highlighting
Hover datasheets / diagnostic notes
7. 3D Bench Twin (Three.js)
3D visualization of the lab setup
8. AI & Knowledge Assistants
Offline Assistant — MiniSearch-powered diagnostic chatbot that works without internet and uses the live bench context (voltages, faults, DTCs, multimeter readings)
Grounded Search — Gemini + Google Search grounding for real-time TSBs, OEM procedures, and DTC research
ECU Repair Knowledge Base
Diagnostic Guide Panel
9. Cloud & Productivity Features
Firebase authentication (Google Sign-In)
Save / restore full bench sessions and diagnostic logs
Google Docs integration for OEM-style diagnostic reports and notes
Performance monitor widget
10. Supporting Systems
Audio feedback
Voice command parser (present in codebase)
Mobile-responsive HUD interface
Simulation speed control
Reset to factory state

Potential Benefits for Technicians
Training & Skill Building
Practice complex electrical diagnostics (opens, shorts, corrosion, CAN bus issues) safely and repeatedly without risking a customer vehicle or expensive test ECUs.
Learn the relationship between physical faults and actual DTCs in a controlled environment.
Build confidence with multimeter, oscilloscope, and pinout reading before touching a real car.
Daily Shop Productivity
Quickly look up accurate pinouts, wire colors, and power-up sequences for common ECUs (especially Toyota/Denso).
Simulate a suspected fault on the virtual bench to confirm diagnosis strategy before probing the vehicle.
Generate professional diagnostic notes and reports
