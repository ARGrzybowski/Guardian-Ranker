# Guardian-Ranker

**Guardian-Ranker** is a web application for Destiny 2 players and others interested. It allows users to search for player stats, compare them to others, and view dynamic leaderboards. The app also displays the current active season, its duration, and a countdown to the next weekly reset.

## Demo

[Try Live Demo](https://argrzybowski.github.io/Guardian-Ranker/)  

<img width="1881" height="911" alt="image" src="https://github.com/user-attachments/assets/28aee728-0cdc-4e70-8144-30a6d403d30d" />


## Features

- **Player Stat Search:** Find and view detailed stats for any Destiny 2 player.
- **Leaderboards:** Automatically rank searched players across several leaderboards for direct comparison.
- **Season Info:** Shows the current Destiny 2 season, its overall duration, and a live countdown to the next weekly reset.
- **No Installation Required:** Guardian-Ranker is a browser-based application.

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript  
- **Backend/Data:** Supabase  
- **API:** Bungie API  

## Usage

Open the Guardian-Ranker webpage in any modern browser.  
Search for a player’s name and explore the leaderboards and season information.

## Search behavior

Enter the complete Bungie name and four-digit code (for example, `Hawk#7753`) to look up an account directly. Full-name searches use Bungie's exact-name endpoint and do not depend on the account appearing in paginated prefix results.

Partial names show the first page of suggestions. If there are more matches, refine the prefix or enter the full name and code. Typing is debounced, and starting another search cancels the previous one.

Cross-save uses the active membership. For independent platform accounts, the profile with the most recently played public characters is displayed. Private or empty profiles show an explanatory message. Successfully loaded profiles remain visible if leaderboard storage is unavailable.

Leaderboards contain searched players, refreshed when they are searched again. They are not global Destiny rankings. Missing/private metrics do not overwrite existing saved values.

## Development

If you’d like to run it locally:  

```bash
# Clone the repository
git clone https://github.com/ARGrzybowski/Guardian-Ranker.git

cd Guardian-Ranker
npm ci
npm start
```

Use the HTTP URL printed by live-server. Opening `index.html` directly from disk can block JavaScript module loading.

## Verification

Run the regression suite with Node.js 20 or newer:

```bash
node --test tests/*.test.js
# Or: npm test
```

Browser integration checks use an installed Microsoft Edge and require no test dependencies:

```bash
node tests/browser-smoke.mjs
```

Set `BROWSER_PATH` to use a different Chromium-based browser executable. The browser suite mocks all Bungie and Supabase responses, never writes to the live database, and saves ignored screenshots in `test-artifacts/`.
