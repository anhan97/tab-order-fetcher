import { Link } from "react-router-dom";

export const PrivacyPolicyPage = () => {
    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
                <div className="bg-white shadow rounded-lg p-8">
                    <div className="mb-8">
                        <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm">
                            ← Back to App
                        </Link>
                    </div>

                    <h1 className="text-3xl font-bold text-gray-900 mb-6">Privacy Policy</h1>
                    <p className="text-sm text-gray-500 mb-8">Last updated: December 16, 2024</p>

                    <div className="prose prose-gray max-w-none space-y-6">
                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Introduction</h2>
                            <p className="text-gray-700 leading-relaxed">
                                Welcome to Tab Order Fetcher ("we," "our," or "us"). We respect your privacy and are committed to protecting your personal data. This privacy policy explains how we collect, use, disclose, and safeguard your information when you use our Shopify application.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
                            <p className="text-gray-700 leading-relaxed mb-3">We may collect the following types of information:</p>
                            <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
                                <li><strong>Store Information:</strong> Shop name, domain, and access tokens provided through Shopify OAuth</li>
                                <li><strong>Order Data:</strong> Order details, customer information, and fulfillment data from your Shopify store</li>
                                <li><strong>Usage Data:</strong> Information about how you use our application, including features accessed and actions taken</li>
                                <li><strong>Technical Data:</strong> IP address, browser type, and device information</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. How We Use Your Information</h2>
                            <p className="text-gray-700 leading-relaxed mb-3">We use the collected information for the following purposes:</p>
                            <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
                                <li>To provide and maintain our application services</li>
                                <li>To process and manage your orders and fulfillments</li>
                                <li>To communicate with you about updates, support, and service-related matters</li>
                                <li>To improve our application and develop new features</li>
                                <li>To comply with legal obligations</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Data Sharing and Disclosure</h2>
                            <p className="text-gray-700 leading-relaxed mb-3">We do not sell your personal data. We may share your information only in the following circumstances:</p>
                            <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
                                <li>With Shopify, as required to provide our services through their platform</li>
                                <li>With service providers who assist in operating our application</li>
                                <li>When required by law or to protect our legal rights</li>
                                <li>With your explicit consent</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data Security</h2>
                            <p className="text-gray-700 leading-relaxed">
                                We implement appropriate technical and organizational measures to protect your personal data against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the Internet or electronic storage is 100% secure.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Data Retention</h2>
                            <p className="text-gray-700 leading-relaxed">
                                We retain your personal data only for as long as necessary to fulfill the purposes outlined in this policy, unless a longer retention period is required by law. When you uninstall our application, we will delete your data within 30 days.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Your Rights</h2>
                            <p className="text-gray-700 leading-relaxed mb-3">Depending on your location, you may have the following rights:</p>
                            <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
                                <li>Access and receive a copy of your personal data</li>
                                <li>Rectify any inaccurate or incomplete data</li>
                                <li>Request deletion of your personal data</li>
                                <li>Object to or restrict processing of your data</li>
                                <li>Data portability</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Cookies and Tracking</h2>
                            <p className="text-gray-700 leading-relaxed">
                                Our application may use cookies and similar tracking technologies to enhance your experience. You can control cookie settings through your browser preferences.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Changes to This Policy</h2>
                            <p className="text-gray-700 leading-relaxed">
                                We may update this privacy policy from time to time. We will notify you of any significant changes by posting the new policy on this page and updating the "Last updated" date.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Contact Us</h2>
                            <p className="text-gray-700 leading-relaxed">
                                If you have any questions about this Privacy Policy or our data practices, please contact us at:
                            </p>
                            <p className="text-gray-700 mt-2">
                                <strong>Email:</strong> support@taborderfetcher.com
                            </p>
                        </section>
                    </div>

                    <div className="mt-10 pt-6 border-t border-gray-200">
                        <Link to="/terms" className="text-blue-600 hover:text-blue-800">
                            View Terms of Service →
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PrivacyPolicyPage;
