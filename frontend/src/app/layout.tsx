import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Lora } from "next/font/google";
import { ThemeProvider } from "next-themes";
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
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}