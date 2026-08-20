import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { Toaster } from "sonner";
import "../styles.css";

const APP_NAME = "NetPulse";
const host = import.meta.env.VITE_PUBLIC_HOSTNAME;
const ogImage = host
  ? `https://og.grok.me/v1/card.png?host=${encodeURIComponent(host)}&title=${encodeURIComponent(APP_NAME)}`
  : undefined;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "description", content: "DNS, Seitenladezeiten und Ressourcen-Engpässe in einem Tool." },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      { name: "theme-color", content: "#0b0c0e" },
      { name: "color-scheme", content: "dark" },
      { name: "twitter:card", content: "summary_large_image" },
      ...(ogImage
        ? [
            { property: "og:image", content: ogImage },
            { property: "og:image:width", content: "1200" },
            { property: "og:image:height", content: "630" },
          ]
        : []),
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: "/netpulse.css" },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
    styles: [
      {
        children:
          "html,body{background:#0b0c0e;color:#ececef;margin:0;min-height:100%;font-family:Segoe UI,system-ui,sans-serif}",
      },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="de" suppressHydrationWarning style={{ background: "#0b0c0e", color: "#ececef" }}>
      <head>
        <HeadContent />
      </head>
      <body style={{ background: "#0b0c0e", color: "#ececef", margin: 0, minHeight: "100vh" }}>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Toaster theme="dark" position="bottom-center" />
        <Scripts />
      </body>
    </html>
  );
}
