# Discord Quest Completer 🚀

An efficient script designed to automate the process of accepting and completing Discord Quests. This modified version handles Game, Video, and Streaming quests concurrently to save time.

## ✨ Features
* **Auto-Accept:** Automatically finds and starts all available quests.
* **Concurrent Completion:** Finishes quests concurrently.

## 🛠️ How to Use

1. **Open Developer Tools:** Press `Ctrl + Shift + I` in your Discord client. (See **Troubleshooting** if this doesn't work).
2. **Access the Console:** Click on the **Console** tab at the top of the developer window.
3. **Enable Pasting:** If prompted by Discord, type `allow pasting` and hit **Enter**.
4. **Run the Script:** Paste the provided code into the console and press **Enter**.
5. **Finalize:**
   * Close the Developer Tools.
   * **Game & Video Quests:** These will finish automatically.
   * **Streaming Quests:** Join a voice channel and start streaming.

## 🛠️ Troubleshooting (Console won't open?)

If `Ctrl + Shift + I` does not work, do one of the following:
* **Install Vencord:** Use [Vencord](https://vencord.dev/) to enable developer tools.
* **Use Discord PTB:** Download the [Public Test Build (PTB)](https://discord.com/api/downloads/distributions/app/installers/latest?channel=ptb&platform=win&arch=x64).
* **Manual Override:** 1. Press `Win + R` and type `%appdata%/discord/settings.json`.
    2. Add the following line to the file:
    `"DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING": true`

## 💎 Credits
This is a modified version of the original script. **All credits go to [aamiaa](https://github.com/aamiaa)** for the foundational work.

## ⚠️ Disclaimer
Use this tool at your own risk. Using automated scripts on Discord can technically be against their Terms of Service. 

## 📜 License
[MIT](LICENSE)
