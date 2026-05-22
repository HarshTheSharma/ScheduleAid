<p align="center">
  <img src="src/assets/ScheduleAid.png" width="128" alt="ScheduleAI'd" />
</p>

<p align="center">
  <a href="https://github.com/HarshTheSharma/ScheduleAid/actions/workflows/build.yml">
    <img src="https://github.com/HarshTheSharma/ScheduleAid/actions/workflows/build.yml/badge.svg" alt="Build" />
  </a>
  <a href="https://github.com/HarshTheSharma/ScheduleAid/actions/workflows/test.yml">
    <img src="https://github.com/HarshTheSharma/ScheduleAid/actions/workflows/test.yml/badge.svg" alt="Tests" />
  </a>
  <img src="https://img.shields.io/badge/react-19.2.6-61DAFB?logo=react&logoColor=white" alt="React 19.2.6" />
  <img src="https://img.shields.io/badge/vite-8-646CFF?logo=vite&logoColor=white" alt="Vite 8" />
</p>

# ScheduleAI'd

A Google Calendar assistant powered by the Gemini API. Manage events through natural language: create, reschedule, delete, and get daily briefings, all from a single chat interface alongside a live weekly calendar view.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Google Cloud Console Setup](#google-cloud-console-setup)
- [Getting a Gemini API Key](#getting-a-gemini-api-key)
- [Environment Variables](#environment-variables)
- [Installation](#installation)
- [Running the App](#running-the-app)
- [Running Tests](#running-tests)
- [Dependencies](#dependencies)
- [Project Structure](#project-structure)

---

## Prerequisites

- **Node.js** 18 or higher
- A **Google account**
- A **Google Cloud project** with OAuth credentials (see below)
- A **Gemini API key** from Google AI Studio (free tier, no billing required)

---

## Google Cloud Console Setup

The app uses Google's OAuth implicit flow to access the Calendar API on the user's behalf. You need a Web Application OAuth client ID.

### 1. Create or select a project

Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project (or select an existing one).

### 2. Enable the Google Calendar API

Navigate to **APIs & Services > Library**, search for **Google Calendar API**, and click **Enable**.

### 3. Configure the OAuth consent screen

Go to **APIs & Services > OAuth consent screen**.

- **User type:** External
- **App name:** ScheduleAI'd (or whatever you prefer)
- **Support email:** your email
- **Authorized domains:** your production domain (not needed for local-only use)

Under **Scopes**, add:

| Scope | Description |
|---|---|
| `https://www.googleapis.com/auth/calendar` | Read and write access to Google Calendar |

Under **Test users**, add every Google account that needs to sign in while the app is in the *Testing* publishing status. Users not on this list will be blocked by Google. To open the app to any Google account, publish to production (requires Google verification for sensitive scopes).

### 4. Create an OAuth 2.0 Client ID

Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID**.

- **Application type:** Web application
- **Name:** ScheduleAI'd Web Client (or similar)

**Authorized JavaScript origins:** add every origin the app will be served from:

| Environment | Origin |
|---|---|
| Local dev | `http://localhost:5173` |
| Production | `https://yourdomain.com` |

**Authorized redirect URIs:** the implicit flow does not use a redirect URI, but Google may require at least one entry. Add the same origins here if prompted.

Copy the generated **Client ID** and use it as your `VITE_GOOGLE_CLIENT_ID`.

---

## Getting a Gemini API Key

1. Go to [aistudio.google.com](https://aistudio.google.com/app/apikey)
2. Click **Create API key**
3. Copy the key

The app runs entirely on the **free tier**. No billing account or credit card is required. The key is entered by the user inside the app on first launch and stored in their browser's `localStorage`. It is never sent to any backend server.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your OAuth Client ID:

```bash
cp .env.example .env
```

`.env`:

```
VITE_GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
```

The Gemini API key is **not** an environment variable. It is entered at runtime by the user inside the app.

---

## Installation

```bash
npm install
```

---

## Running the App

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

To build for production:

```bash
npm run build
npm run preview   # serve the dist/ folder locally
```

---

## Running Tests

```bash
npm test            # run once
npm test -- --watch # watch mode
```

86 tests covering the auth layer, calendar API handler, assistant tool loop, and top-level app flow.

---

## Dependencies

### Runtime

| Package | Version | Purpose |
|---|---|---|
| `react` | ^19 | UI framework |
| `react-dom` | ^19 | DOM renderer |
| `@react-oauth/google` | ^0.13 | Google OAuth implicit flow and GIS integration |

All calendar and AI requests go directly from the browser to Google's APIs. There is no backend server.

| External API | Auth | Used for |
|---|---|---|
| Google Calendar REST API v3 | OAuth 2.0 access token | Read, create, modify, and delete calendar events |
| Gemini API (`generativelanguage.googleapis.com`) | API key | Natural language understanding and function calling |

### Dev / Build

| Package | Purpose |
|---|---|
| `vite` + `@vitejs/plugin-react` | Build tooling and dev server |
| `@rolldown/plugin-babel` + `babel-plugin-react-compiler` | React Compiler (experimental optimizations) |
| `vitest` | Test runner |
| `@testing-library/react` + `@testing-library/user-event` | Component testing utilities |
| `jsdom` | Browser environment for tests |
| `eslint` + plugins | Linting |

---

## Project Structure

```
src/
  assets/               # Logo images
  components/
    ApiKeySetup         # First-run API key entry screen
    CalendarView        # Weekly calendar grid
    MessageView         # Chat interface and action confirmation cards
  lib/
    AssistantHandler.js # Gemini API integration, tool loop, daily briefing
    CalendarHandler.js  # Google Calendar REST API wrapper
    GoogleAuth.jsx      # OAuth provider and token persistence
  test/
    App.test.jsx
    AssistantHandler.test.js
    CalendarHandler.test.js
    GoogleAuth.test.jsx
  App.jsx               # Root layout, settings menu, routing between screens
  main.jsx              # Entry point
```

---

## License

© 2026 [HarshSharma.dev](https://HarshSharma.dev). All rights reserved.
