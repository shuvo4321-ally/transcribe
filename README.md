# Manhwa Translator Pro

Upload a zip of manhwa images and get the speech bubbles extracted and translated into English text. Built with React and Gemini.

## How it works

1. Drop a `.zip` of page images onto the app.
2. Each page is sent to Gemini, which finds the speech bubbles and translates them.
3. Download the translated text.

## Features

- Drag-and-drop zip upload
- Page-by-page progress and error reporting
- **API key rotation**: when one key hits its quota, the app switches to the next one automatically

## Tech stack

React, TypeScript, Vite, Tailwind CSS, Gemini (`@google/genai`), JSZip, Motion

## Getting started

Prerequisites: Node.js 18+ and at least one [Gemini API key](https://aistudio.google.com/apikey).

```bash
npm install
cp .env.example .env
```

Set `GEMINI_API_KEY` in `.env`. Optionally add `GEMINI_API_KEY_2` to `GEMINI_API_KEY_5` for automatic rotation.

```bash
npm run dev     # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | Type-check with `tsc` |