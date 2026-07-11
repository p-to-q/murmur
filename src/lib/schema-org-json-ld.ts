import { getSiteUrl } from "./site-url";
import { SITE_CONFIG } from "./constants";

export function getSiteSchemaOrgGraph() {
  const origin = getSiteUrl();

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://ptoq.io/#organization",
        name: "[p → q]",
        url: "https://ptoq.io",
        email: "hi@ptoq.io",
        sameAs: ["https://github.com/p-to-q"],
      },
      {
        "@type": "WebApplication",
        "@id": `${origin}/#webapplication`,
        name: SITE_CONFIG.name,
        url: origin,
        description: SITE_CONFIG.description,
        applicationCategory: "Multimedia",
        operatingSystem: "Web",
        browserRequirements: "Requires JavaScript and audio input",
        publisher: { "@id": "https://ptoq.io/#organization" },
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
      },
    ],
  };
}
