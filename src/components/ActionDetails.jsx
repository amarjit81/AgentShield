import { Alert, Button } from '@mui/material';

function FileContent({ title, content }) {
  return <div className="file-content"><h3>{title}</h3><pre>{content || '(empty file)'}</pre></div>;
}

export default function ActionDetails({ action, currentFile }) {
  if (action.action === 'REFUND') {
    const limits = action.policyDecision?.policy;
    const format = value => new Intl.NumberFormat('en-IN').format(value);
    return <div className="refund-document">
      <span className="document-label">Requested refund</span>
      <strong>₹{format(action.arguments.amount)} <small>{action.arguments.currency}</small></strong>
      <span className="document-meta">Target · {action.target}</span>
      {Number.isFinite(limits?.autoApproveLimit) && Number.isFinite(limits?.maxAllowedRefund) && <dl className="refund-limits">
        <div><dt>Auto-approve through</dt><dd>₹{format(limits.autoApproveLimit)}</dd></div>
        <div><dt>Maximum refund</dt><dd>₹{format(limits.maxAllowedRefund)}</dd></div>
      </dl>}
    </div>;
  }

  if (action.action === 'SANDBOX_FILE') {
    const { operation, content } = action.arguments;
    const proposed = ['WRITE', 'CHANGE'].includes(operation);
    return <div className="file-document">
      <span className="document-label">Sandbox file · {operation}</span>
      <code className="file-path">{action.target}</code>
      <div className={currentFile && proposed ? 'file-comparison' : undefined}>
        {currentFile && <div>
          {currentFile.filePreview
            ? <FileContent title="Current file contents before approval" content={currentFile.filePreview.content} />
            : <Alert severity="warning">{currentFile.filePreviewError || 'Loading file preview...'}</Alert>}
          <Button size="small" disabled={currentFile.busy} onClick={currentFile.refresh}>Refresh file preview</Button>
        </div>}
        {proposed && <FileContent title={operation === 'CHANGE' ? 'Proposed replacement content' : 'Proposed new file content'} content={content} />}
      </div>
    </div>;
  }

  return <article className="email-document">
    <div className="document-meta">{action.executionMode === 'SMTP' ? `Real email from ${action.emailSender}` : 'Email simulation · No delivery'}</div>
    <h3>{action.arguments.subject}</h3>
    <div className="document-meta">To · {action.target}</div>
    <div className="message-body">{action.arguments.body}</div>
  </article>;
}
