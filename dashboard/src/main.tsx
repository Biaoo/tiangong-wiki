import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import { render } from "preact";

import { App } from "./App";
import "./styles/app.css";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Dashboard root element #app not found.");
}

render(<App />, root);
