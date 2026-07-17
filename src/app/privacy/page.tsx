import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy - Poke Deal",
  description: "Privacy notice for Poke Deal.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-page" id="main-content">
      <section className="legal-panel">
        <p className="eyebrow">Poke Deal</p>
        <h1>Privacy Notice</h1>
        <p>
          Poke Deal is a private stock, pricing and selling tool for a single card dealing business.
          It is used to manage inventory, comps, listings, sales and profit records.
        </p>

        <h2>What the app stores</h2>
        <p>
          The app stores card and business records that are entered into it, including inventory details,
          purchase costs, listing prices, sale prices, fees, postage, grades, cert numbers, notes and linked
          listing references.
        </p>

        <h2>eBay access</h2>
        <p>
          eBay access is used only to connect the seller account, create inventory offers, publish listings
          and read the account settings required to prepare those listings. The app does not collect eBay
          passwords.
        </p>

        <h2>Third-party services</h2>
        <p>
          The app may use card-pricing, catalog, database, hosting and marketplace APIs to provide comps,
          catalog data, listing automation and business records. API keys and tokens are stored as private
          environment variables and are not committed to the source repository.
        </p>

        <h2>Access and revocation</h2>
        <p>
          eBay app access can be revoked from the eBay account security settings at any time. Reconnecting
          through Poke Deal replaces the stored access token used for automated eBay actions.
        </p>

        <h2>Contact</h2>
        <p>
          For privacy or access questions, use the eBay Developer account or repository owner details
          associated with this private app.
        </p>
      </section>
    </main>
  );
}
