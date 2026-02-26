# Resizo

A high-performance, client-side web application for secure and instant image processing.

## Features

- Client-Side Processing: All image resizing and format conversion occurs directly within the browser, ensuring user data privacy and zero server upload latency.
- Format Support: Read and convert between JPEG, PNG, and WebP formats.
- Precision Resizing: Scale images by exact pixel dimensions or by percentage ratios.
- Aspect Ratio Maintenance: Automatic calculation of dimensions to prevent image distortion.
- Responsive Design: A premium, viewport-snapping scroll layout built for modern displays.

## Tech Stack

- Framework: Next.js 15
- Styling: Tailwind CSS
- Core Logic: HTML5 Canvas API, standard Web APIs (FileReader, Object URLs)
- Architecture: 100% Client-side Rendering (CSR) for the core tool

## Getting Started

### Prerequisites

- Node.js 18.x or higher
- npm or yarn package manager

### Installation

1. Clone the repository
2. Navigate to the project directory
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Access the application at `http://localhost:3000`

## Security

The application implements strict client-side validation to ensure stability and security:

- Magic Byte Validation: Verifies file authenticity by reading the initial hex signatures (e.g., FFD8FF for JPEG) rather than relying on file extensions.
- Size Constraints: Enforces a strict 20MB upper limit on file uploads to prevent browser memory exhaustion.
- Dimension Limits: Rejects images exceeding 8000x8000 pixels prior to processing.
- Input Sanitization: Strips non-alphanumeric characters from original filenames before generating the downloadable output.

## Project Structure

```text
resizo/
├── app/
│   ├── globals.css      # Global Tailwind directives and base layer styles
│   ├── layout.js        # Root Next.js layout component
│   └── page.js          # Main application interface and canvas processing logic
├── public/              # Static assets
├── package.json         # Project metadata and dependencies
└── README.md            # Project documentation
```

## Roadmap

The following features are planned for the V2 release:

- Server-Side Processing: Implementation of Node.js and the Sharp image processing library for high-throughput batch operations.
- Containerization: Comprehensive Docker support for isolated and scalable deployments.
- Analytics: Integration with PostgreSQL for tracking aggregate processing metrics and application usage.

## Contributing

Contributions are welcome. Please ensure that any pull requests align with the existing code style and architecture. All significant changes should be discussed in an issue prior to implementation.

## License

This project is licensed under the MIT License.
