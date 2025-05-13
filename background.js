// Listen for keyboard commands and forward to content script
browser.commands.onCommand.addListener((cmd) => {
  const delta = cmd === "increase-speed" ? 0.1 : -0.1;
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    if (tabs[0]?.id) {
      browser.tabs.sendMessage(tabs[0].id, { action: "adjust", delta });
    }
  });
});
