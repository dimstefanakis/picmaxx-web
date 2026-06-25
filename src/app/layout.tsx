import type { Metadata } from "next";
import {
  Archivo_Black,
  Instrument_Serif,
  Manrope,
  Geist_Mono,
} from "next/font/google";
import Script from "next/script";
import "./globals.css";

const META_PIXEL_ID = "1532157435278333";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const archivoBlack = Archivo_Black({
  variable: "--font-archivo-black",
  subsets: ["latin"],
  weight: "400",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PicMaxx Waitlist",
  description: "Join PicMaxx. Men get 5x more matches.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${archivoBlack.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${META_PIXEL_ID}');
            var picmaxxEventId = 'pv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
            fbq('track', 'PageView', {}, { eventID: picmaxxEventId });
            function picmaxxCookieOptions() {
              var options = '; path=/; max-age=7776000; SameSite=Lax';
              return window.location.protocol === 'https:' ? options + '; Secure' : options;
            }
            function picmaxxCookie(name) {
              var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
              return match ? decodeURIComponent(match[1]) : '';
            }
            function picmaxxRandomId() {
              if (window.crypto && window.crypto.getRandomValues) {
                var values = new Uint32Array(2);
                window.crypto.getRandomValues(values);
                return String(values[0]) + String(values[1]);
              }
              return Math.floor(Math.random() * 1000000000000000000).toString();
            }
            function picmaxxEnsureFbp() {
              var fbp = picmaxxCookie('_fbp');
              if (fbp) return fbp;
              fbp = 'fb.1.' + Date.now() + '.' + picmaxxRandomId();
              document.cookie = '_fbp=' + encodeURIComponent(fbp) + picmaxxCookieOptions();
              return fbp;
            }
            function picmaxxEnsureFbc() {
              var fbc = picmaxxCookie('_fbc');
              if (fbc) return fbc;
              var fbclid = new URLSearchParams(window.location.search).get('fbclid');
              if (!fbclid) return '';
              fbc = 'fb.1.' + Date.now() + '.' + fbclid;
              document.cookie = '_fbc=' + encodeURIComponent(fbc) + picmaxxCookieOptions();
              return fbc;
            }
            function picmaxxSendPageViewCapi() {
              fetch('/api/meta/page-view', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                body: JSON.stringify({
                  eventId: picmaxxEventId,
                  sourceUrl: window.location.href,
                  referrer: document.referrer,
                  fbp: picmaxxEnsureFbp(),
                  fbc: picmaxxEnsureFbc()
                })
              }).catch(function() {});
            }
            window.setTimeout(picmaxxSendPageViewCapi, 250);
          `}
        </Script>
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
            alt=""
          />
        </noscript>
        {children}
      </body>
    </html>
  );
}
