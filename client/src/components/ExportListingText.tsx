import { useRef, useState, useEffect } from 'react';
import { api } from '../api';
import { useToast } from './Toast';
import { Spinner } from './ui';

interface Props {
  project: any;
  onClose: () => void;
}

export default function ExportListingText({ project, onClose }: Props) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const generate = async (regenerate = false) => {
    setLoading(true);
    setError(null);
    try {
      const { text: generated } = await api.generateListingText(project.id, regenerate);
      setText(generated);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => { generate(); }, []);

  const handleCopy = async () => {
    const value = textRef.current?.value || text;
    try {
      await navigator.clipboard.writeText(value);
      toast('success', 'Copied to clipboard');
    } catch {
      textRef.current?.select();
      document.execCommand('copy');
      toast('success', 'Copied to clipboard');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Export Listing Text</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-sm text-gray-500">
              <Spinner />
              Generating listing copy...
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-sm text-red-500 mb-3">{error}</p>
              <button onClick={() => generate()} className="text-sm text-blue-600 hover:underline">Try again</button>
            </div>
          ) : (
            <>
              <textarea
                ref={textRef}
                defaultValue={text}
                rows={14}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y"
              />
              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={() => generate(true)}
                  disabled={loading}
                  className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Regenerate
                </button>
                <button
                  onClick={handleCopy}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Copy to Clipboard
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
