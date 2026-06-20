"use client";

import Image from "next/image";
import Link from "next/link";
import { CSSProperties, useState } from "react";
import styles from "./page.module.css";

const comparisonPhotos = {
  before: {
    src: "/demo-photos/picmaxx-before.webp",
    matches: "8 matches",
    label: "before",
  },
  after: {
    src: "/demo-photos/picmaxx-after.webp",
    matches: "41 matches",
    label: "after PicMaxx",
  },
};

export default function Home() {
  const [comparisonSplit, setComparisonSplit] = useState(64);
  const comparisonStyle = {
    "--split": `${comparisonSplit}%`,
  } as CSSProperties;

  return (
    <main className={styles.page}>
      <header className={styles.topbar} aria-label="PicMaxx">
        <a className={styles.brand} href="#" aria-label="PicMaxx home">
          <span className={styles.brandMark}>picmaxx</span>
          <span className={styles.brandDot} aria-hidden="true" />
        </a>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.copy}>
          <div>
            <h1 id="hero-title" className={styles.title}>
              Get 5x
              <br />
              more
              <br />
              matches
            </h1>
          </div>

          <div className={styles.promiseRow}>
            <p className={styles.promise}>
              Find the photos that put you in the <em>top 10%</em>. Ranked by
              real women before you swipe.
            </p>

            <div className={styles.waitlist}>
              <Link className={styles.payCta} href="/test">
                <span>Get my best photo</span>
                <strong>Start test</strong>
              </Link>
              <p className={styles.status}>Upload photos. Results within 24h.</p>
            </div>
          </div>
        </div>

        <div className={styles.visual}>
          <div className={styles.comparisonShell}>
            <div className={styles.comparisonFrame} style={comparisonStyle}>
              <div className={`${styles.comparisonLayer} ${styles.beforeLayer}`}>
                <Image
                  className={styles.comparisonImage}
                  src={comparisonPhotos.before.src}
                  alt="Before PicMaxx profile photo"
                  fill
                  priority
                  sizes="(max-width: 720px) 86vw, (max-width: 1080px) 440px, 36vw"
                />
                <div className={`${styles.matchBadge} ${styles.beforeBadge}`}>
                  <span>{comparisonPhotos.before.label}</span>
                  <strong>{comparisonPhotos.before.matches}</strong>
                </div>
              </div>

              <div className={`${styles.comparisonLayer} ${styles.afterLayer}`}>
                <Image
                  className={styles.comparisonImage}
                  src={comparisonPhotos.after.src}
                  alt="After PicMaxx profile photo"
                  fill
                  priority
                  sizes="(max-width: 720px) 86vw, (max-width: 1080px) 440px, 36vw"
                />
                <div className={`${styles.matchBadge} ${styles.afterBadge}`}>
                  <span>{comparisonPhotos.after.label}</span>
                  <strong>{comparisonPhotos.after.matches}</strong>
                </div>
              </div>

              <input
                className={styles.sliderInput}
                type="range"
                min="18"
                max="82"
                value={comparisonSplit}
                onChange={(event) =>
                  setComparisonSplit(Number(event.currentTarget.value))
                }
                aria-label="Reveal the before and after photo comparison"
              />

              <div className={styles.sliderRail}>
                <div className={styles.sliderHandle}>
                  <span />
                  <span />
                </div>
              </div>
            </div>

            <div className={styles.liftBadge}>
              <span>5.1x lift</span>
              <strong>photo order fixed</strong>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
