import { Link } from "react-router-dom";

export const TermsOfServicePage = () => {
    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
                <div className="bg-white shadow rounded-lg p-8">
                    <div className="mb-8">
                        <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm">
                            ← Back to App
                        </Link>
                    </div>

                    <h1 className="text-3xl font-bold text-gray-900 mb-6">Terms of Service</h1>
                    <p className="text-sm text-gray-500 mb-8">Last updated: December 16, 2024</p>

                    <div className="prose prose-gray max-w-none space-y-6">
                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Acceptance of Terms</h2>
                            <p className="text-gray-700 leading-relaxed">
                                By installing and using Tab Order Fetcher ("the App," "we," "our," or "us"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, please do not use the App.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Description of Service</h2>
                            <p className="text-gray-700 leading-relaxed">
                                Tab Order Fetcher is a Shopify application that helps merchants manage orders, track fulfillments, analyze COGS (Cost of Goods Sold), and streamline their order management workflow. The App integrates with your Shopify store to provide these services.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Account Requirements</h2>
                            <p className="text-gray-700 leading-relaxed mb-3">To use our App, you must:</p>
                            <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
                                <li>Have a valid Shopify store account</li>
                                <li>Be at least 18 years of age or the age of majority in your jurisdiction</li>
                                <li>Provide accurate and complete information during installation</li>
                                <li>Maintain the security of your Shopify account credentials</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Authorized Use</h2>
                            <p className="text-gray-700 leading-relaxed mb-3">You agree to use the App only for lawful purposes and in accordance with these Terms. You agree NOT to:</p>
                            <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
                                <li>Use the App in any way that violates applicable laws or regulations</li>
                                <li>Attempt to gain unauthorized access to any part of the App or its systems</li>
                                <li>Interfere with or disrupt the App's servers or networks</li>
                                <li>Reverse engineer, decompile, or disassemble any part of the App</li>
                                <li>Use the App for any fraudulent or harmful purpose</li>
                                <li>Share your access credentials with unauthorized third parties</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data and Privacy</h2>
                            <p className="text-gray-700 leading-relaxed">
                                Your use of the App is also governed by our <Link to="/privacy" className="text-blue-600 hover:text-blue-800">Privacy Policy</Link>, which describes how we collect, use, and protect your data. By using the App, you consent to our data practices as described in the Privacy Policy.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Intellectual Property</h2>
                            <p className="text-gray-700 leading-relaxed">
                                The App and all its content, features, and functionality are owned by us and are protected by international copyright, trademark, and other intellectual property laws. You may not copy, modify, distribute, or create derivative works based on the App without our express written consent.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Disclaimer of Warranties</h2>
                            <p className="text-gray-700 leading-relaxed">
                                THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE APP WILL BE UNINTERRUPTED, ERROR-FREE, OR COMPLETELY SECURE.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Limitation of Liability</h2>
                            <p className="text-gray-700 leading-relaxed">
                                TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL WE BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, OR USE, ARISING OUT OF OR RELATED TO YOUR USE OF THE APP, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Indemnification</h2>
                            <p className="text-gray-700 leading-relaxed">
                                You agree to indemnify and hold us harmless from any claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or related to your use of the App, your violation of these Terms, or your violation of any rights of a third party.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Modifications to Service</h2>
                            <p className="text-gray-700 leading-relaxed">
                                We reserve the right to modify, suspend, or discontinue the App (or any part thereof) at any time, with or without notice. We shall not be liable to you or any third party for any modification, suspension, or discontinuation of the App.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Changes to Terms</h2>
                            <p className="text-gray-700 leading-relaxed">
                                We may revise these Terms at any time by posting an updated version on this page. Your continued use of the App after any changes constitutes your acceptance of the revised Terms. We encourage you to review these Terms periodically.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">12. Termination</h2>
                            <p className="text-gray-700 leading-relaxed">
                                We may terminate or suspend your access to the App immediately, without prior notice, for any reason, including without limitation if you breach these Terms. Upon termination, your right to use the App will immediately cease.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">13. Governing Law</h2>
                            <p className="text-gray-700 leading-relaxed">
                                These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which we operate, without regard to its conflict of law provisions.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">14. Contact Information</h2>
                            <p className="text-gray-700 leading-relaxed">
                                If you have any questions about these Terms, please contact us at:
                            </p>
                            <p className="text-gray-700 mt-2">
                                <strong>Email:</strong> support@taborderfetcher.com
                            </p>
                        </section>
                    </div>

                    <div className="mt-10 pt-6 border-t border-gray-200">
                        <Link to="/privacy" className="text-blue-600 hover:text-blue-800">
                            View Privacy Policy →
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TermsOfServicePage;
