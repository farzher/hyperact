const input = document.querySelector("#input");

input.focus();

window.addEventListener("focus", () => input.focus());

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    input.value = "";
    input.focus();
  }
});
