# 🦙✨🧠 TurboLearn AI — Dual-Core Native Study Engine

TurboLearn AI is an industry-grade, premium study platform and AI consensus engine designed to synthesize intelligence across multiple cutting-edge models concurrently. Built as a high-performance monorepo, it unites a server-side Next.js web application and administrative portal with a fully responsive, native React Native / Expo mobile application. 

The platform queries **Llama 3.3 (Groq)**, **Gemini 2.5 (Google)**, and **DeepSeek R1/V3** in parallel, running a local client-side consensus synthesis algorithm to extract key agreements, distinct perspectives, and unique insights for students and professionals.

---

## 🏛️ Project Architecture

This workspace is structured as a unified monorepo:

```
turbolearn-ai/
├── app/                  # Next.js Server & Web Application Portal
│   ├── admin/            # Forensic Admin Audit & Purge Portal
│   └── api/              # Secure Serverless Backend API Gateways
├── components/           # Shared React Web Components
├── lib/                  # Web Firebase, Redis, & Security Libraries
├── mobile/               # React Native / Expo Mobile Application
│   ├── src/
│   │   ├── app/          # Navigation Screens (Dynamic Tabs & Sidebar)
│   │   ├── components/   # Safe-bound Markdown & Collapsible UI
│   │   └── lib/          # Native Firebase Auth Persistence & API Clients
│   └── .env              # Production Mobile Environment Credentials
└── .env                  # Web Server Environment Credentials
```

---

## 🚀 Key Features

### 💻 Web & API Server (`app/`)
* **Dual-Core AI Synthesis Gateway**: Concurrent backend routes query multiple API suppliers securely under strict serverless execution constraints.
* **Forensic Admin Dashboard**: A premium, responsive dashboard (`/admin`) allowing administrators to monitor usage, audit soft-deleted sessions using user cache maps to optimize Firestore costs, and permanently purge data via a transaction-safe endpoint.
* **PWA & Local Engine Caching**: PWA capabilities combined with Redis-backed rate-limiting to protect API budgets and cap spam attacks.

### 📱 Native Mobile App (`mobile/`)
* **Dynamic Tab Labels**: Tab bar headers dynamically display the first two words of the selected model (e.g., `"Gemini 2.5"` or `"Llama 3.3"`) with safe bounds (`numberOfLines={1}`, `ellipsizeMode="tail"`) to guarantee clean, responsive rendering without text-bleeding.
* **Horizontal Swipe Navigation**: Fast, native-like horizontal swipes (`onTouchStart` / `onTouchEnd` hooks) let users switch between Groq, Gemini, and DeepSeek tabs fluidly with automatic keyboard dismissal.
* **Responsive Conversational Layout**: Asymmetric bubble containers (up to `85%` width for users, `94%` for assistant replies) that wrap tight around short messages and use custom bottom corner rounded tails for a premium, native ChatGPT-like look.
* **Local Consensus Synthesis**: A client-side deterministic text relevance algorithm (>0.25 overlap threshold) that parses agreements and highlights unique insights in a pulsing, emerald sparkles modal.
* **Expo Go Sandbox Safeguard**: Unconditional native shields that automatically bind voice recognition modules to safe fallback hooks in standard sandboxes, ensuring complete sandbox stability without startup crashes.
* **Premium Custom Sidebar**: A fully responsive slide-drawer (`zIndex: 100`) designed with a dynamic width (`Math.min(280, width * 0.82)`) and depth drop-shadows. Includes a glowing gold "PRO" badge for subscribed tiers, a custom circular user avatar profile card, and a large dismiss `X` button.

---

## 🛠️ Technology Stack

| Layer | Technologies Used |
| :--- | :--- |
| **Core Client & Web** | React 19, Next.js 16 (App Router), TypeScript, TailwindCSS |
| **Native Mobile** | React Native, Expo SDK 52, Expo Router, Lucide Icons, Ionicons |
| **Database & Auth** | Firebase Authentication, Cloud Firestore (Offline Sync & Persistence) |
| **Server Security** | Upstash Redis (Serverless Rate Limiting), Firebase Admin SDK |
| **Styling (Mobile)** | Vanilla React Native StyleSheet (Fluid Viewports, Flexbox, Safe Area Insets) |

---

## 🔑 Environment Setup

### 1. Web & Serverless API Setup (`/.env`)
Create a `.env` file at the root directory of the project:
```bash
# Firebase Client Credentials
NEXT_PUBLIC_FIREBASE_API_KEY="..."
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="..."
NEXT_PUBLIC_FIREBASE_PROJECT_ID="..."
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="..."
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="..."
NEXT_PUBLIC_FIREBASE_APP_ID="..."

# Firebase Admin Service Account (Multiline Private Key)
FIREBASE_CLIENT_EMAIL="..."
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgk...\n-----END PRIVATE KEY-----"

# Server Caching Cap (Upstash Redis)
REDIS_URL="rediss://..."

# AI API Providers Keys
GROQ_API_KEY="..."
GEMINI_API_KEY="..."
GEMINI_API_KEYS="key1,key2,key3"
DEEPSEEK_API_KEY="..."
DEEPSEEK_API_KEYS="key1,key2"
OPENROUTER_API_KEY="..."
```

### 2. Mobile App Setup (`/mobile/.env`)
Create a `.env` file inside the `/mobile` directory:
```bash
EXPO_PUBLIC_ENABLE_DEMO_LOGIN="false"

# Production Backend Endpoint (Points to your live Vercel Server)
EXPO_PUBLIC_API_URL="https://turbolearnai.vercel.app"

# Client Firebase Configuration
EXPO_PUBLIC_FIREBASE_API_KEY="..."
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN="..."
EXPO_PUBLIC_FIREBASE_PROJECT_ID="..."
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET="..."
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="..."
EXPO_PUBLIC_FIREBASE_APP_ID="..."
```

> [!WARNING]
> Both `.env` files are protected by `.gitignore` rules (`.env*`) inside their respective folders. **Never commit `.env` files to git** to prevent key leakage.

---

## 🏃 Run Locally

### Web Application & APIs
From the root directory:
```bash
# Install dependencies
npm install

# Start Next.js Development Server
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the client and verify the secure serverless endpoints are responding.

### Mobile React Native App
From the root directory:
```bash
# Enter mobile folder
cd mobile

# Install mobile dependencies
npm install

# Start Expo Developer server
npx expo start
```
Use `a` to open in the Android Emulator, `i` for iOS Simulator, or scan the QR code using the Expo Go app on your phone.

---

## 🏗️ Production & Deployment

### 1. Web & Serverless Deploy (Vercel)
The Next.js root compiles successfully out-of-the-box:
1. Push your repository to GitHub.
2. Link the repository to your **Vercel** dashboard.
3. Import all variables from your local root `.env` into Vercel's **Environment Variables** settings.
4. Click **Deploy**!

### 2. Mobile Store Bundle compilation (Expo EAS)
Before building, securely push your local `.env` variables to EAS Cloud so they are compiled into your release binaries:
```bash
# Inside the mobile/ folder:
eas env:push
```
Select the **`production`** profile. Once pushed, trigger the store compilation:
```bash
# Build for Google Play Store (Android App Bundle)
eas build --platform android

# Build for Apple App Store (iOS Bundle)
eas build --platform ios
```
All signing certificates, Keystores, and provisioning profiles are automatically generated and secured by Expo EAS in the cloud!
