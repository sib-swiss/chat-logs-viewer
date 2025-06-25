export interface Summary {
  likes: number;
  likes_sparql: number;
  dislikes: number;
  dislikes_sparql: number;
  langfuse: number;
  langfuse_sparql: number;
  sparql_total: number;
  conversation_total: number;
}

export default function SummaryTable(props: {summary: Summary}) {
  return (
    <table class="summary-table">
      <thead>
        <tr>
          <th>📊 Uploaded logs summary</th>
          <th>🔌 Langfuse</th>
          <th>👍 Likes</th>
          <th>👎 Dislikes</th>
          <th>💬 Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Conversations</td>
          <td>{props.summary.langfuse}</td>
          <td>{props.summary.likes}</td>
          <td>{props.summary.dislikes}</td>
          <td>{props.summary.conversation_total}</td>
        </tr>
        <tr>
          <td>With SPARQL</td>
          <td>{props.summary.langfuse_sparql}</td>
          <td>{props.summary.likes_sparql}</td>
          <td>{props.summary.dislikes_sparql}</td>
          <td>{props.summary.sparql_total}</td>
        </tr>
      </tbody>
    </table>
  );
}
