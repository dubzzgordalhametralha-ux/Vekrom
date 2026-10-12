import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { TipProvider, Toaster } from "./components/ui";
import { ApiError } from "./lib/api";
import "./index.css";

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (n, err) => n < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <TipProvider>
          <App />
          <Toaster />
        </TipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
