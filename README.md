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

## Known Issues

- **Search Autofill Lag:** The autofill in the search box may display results one character behind what’s typed.  
- **Common Name Prefixes:** Players with very common prefixes may not appear in results due to Bungie API pagination limits.  
- **Full Name Search:** Typing a full player name instead of just a prefix can trigger a "No user found" message, even if the account loads successfully.

## Development

If you’d like to run it locally:  

```bash
# Clone the repository
git clone https://github.com/ARGrzybowski/Guardian-Ranker.git

# Open in your browser
cd Guardian-Ranker
open index.html   # or just drag index.html into your browser

