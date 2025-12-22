import React from "react";
import ReactDOM from "react-dom";
import "antd/dist/antd.css";
import { initTokenFromUrl } from "./auth";
import { App } from "./ui/App";

initTokenFromUrl();

ReactDOM.render(<App />, document.getElementById("root"));

