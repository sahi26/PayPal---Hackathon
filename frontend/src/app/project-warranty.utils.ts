export function requiresDigitalWarrantyHold(title: string, industry: string, description: string): boolean {
  const projectText = `${title || ''} ${industry || ''} ${description || ''}`.toLowerCase();
  const complexDigitalTerms = [
    'software', 'web app', 'web application', 'mobile app', 'mobile application',
    'backend', 'fullstack', 'saas', 'api', 'database', 'platform',
    'complex digital', 'complex software',
    'website creation', 'create a website', 'build a website', 'website development',
    'web development', 'e-commerce website', 'ecommerce website'
  ];
  return complexDigitalTerms.some(term => projectText.includes(term));
}
