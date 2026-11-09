const netStatus = document.getElementById("netStatus");

function updateNetStatus() {
  const online = navigator.onLine;
  netStatus.textContent = online ? "Online" : "Offline";
  netStatus.classList.toggle("offline", !online);
}

window.addEventListener("online", updateNetStatus);
window.addEventListener("offline", updateNetStatus);
updateNetStatus();

setInterval(updateNetStatus, 2000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then(() => console.log("Service worker registered"))
      .catch((err) => console.log("Service worker failed:", err));
  });
}