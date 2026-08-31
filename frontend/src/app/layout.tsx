import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Lora } from "next/font/google";
import { ThemeProvider } from "next-themes";
import OfflineStatus from "@/lib/offline-status";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import "./globals.css";

// Inter for the app shell UI, Lora for editor headings (serif gives notes a
// warmer, more "note-taking" feel), JetBrains Mono for code. The CSS
// variables they expose are wired into both Tailwind tokens and Crepe's font
// variables in globals.css.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const lora = Lora({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nexote",
  description: "A markdown note-taking app powered by Milkdown.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Nexote",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a1d29",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={[inter.variable, lora.variable, mono.variable].join(" ")}
    >
      <head>
        {/* Apply the saved color scheme before paint to avoid FOUC. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=localStorage.getItem('nexote:color-scheme');if(s&&s!=='default'){document.documentElement.classList.add('scheme-'+s)}}catch(e){}`,
          }}
        />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <OfflineStatus />
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}