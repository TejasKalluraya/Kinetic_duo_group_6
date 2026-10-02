# Kinetic • AI Adaptive Fitness Agent

Kinetic is an intelligent workout negotiator that reorganizes training around real-life schedule disruptions, work overruns, fatigue, and recovery constraints while protecting long-term progress.

## Features

- **Workout Negotiator**: Multi-turn conversational agent evaluating schedule conflicts, energy levels, and time constraints.
- **3-Turn Free Tier with 4-Option Version Comparison**: After chatting, review and switch between Original (v0) and adapted versions (v1, v2, v3).
- **Zero-Guilt Adaptive Protocol**: Restructured sessions prune lower-priority accessories while preserving primary compound lifts.
- **Duo Sync Overview**: Architectural preview of how partner training synchronization aligns working sets and rest intervals.
- **Weekly Consistency Streak**: GitHub-style weekly contribution tracker for active workouts and intentional recovery days.

## Getting Started Locally

### 1. Prerequisites
- Node.js 18+ or 20+
- npm (comes with Node.js)

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables (Optional)
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Add your Anthropic API key if you want server-side LLM enrichment (optionally set `CLAUDE_MODEL`, default `claude-sonnet-5-5`):
```env
ANTHROPIC_API_KEY=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
PORT=3000
```
*(Note: If no API key is provided, the app uses its built-in deterministic sports science rules engine to perform intelligent adaptations automatically).*

### 4. Run the Development Server
```bash
npm run dev
```
Open your browser and navigate to:
```
http://localhost:3000
```

### 5. Production Build
```bash
npm run build
npm start
```
