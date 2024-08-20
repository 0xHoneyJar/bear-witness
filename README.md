# CubQuest RevShare Verifier

This tool allows CubQuest partners to verify revenue sharing for their quests by checking onchain mints against website visits.

## How It Works

The CubQuest RevShare Verifier operates by comparing two sets of data:

1. Website Visits: These are stored on the Irys testnet blockchain. Each visit to a quest page is recorded as a transaction on Irys, providing a tamper-proof log of user activity.

2. Onchain Mints: The tool tracks NFT mints that occur on the main blockchain where CubQuest operates.

The verifier then matches these two datasets within a specified time window, allowing partners to confirm that mints are correctly attributed to their quest visits.

## Prerequisites

- Node.js (v14 or later)
- npm or yarn

## Setup

1. Clone this repository:

   ```
   git clone https://github.com/your-username/cubquest-revshare-verifier.git
   cd cubquest-revshare-verifier
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Configure the tool:
   - Copy `config/default.json.example` to `config/default.json`
   - Update the values in `config/default.json` with your specific endpoints and addresses

## Usage

Run the script with the following command: