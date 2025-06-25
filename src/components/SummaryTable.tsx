export interface Summary {
  likes: number;
  likes_sparql: number;
  dislikes: number;
  dislikes_sparql: number;
  langfuse: number;
  langfuse_sparql: number;
  sparql_total: number;
}

interface SummaryTableProps {
  summary: Summary;
}

export default function SummaryTable(props: SummaryTableProps) {
  return (
    <div class="summary">
      <h4>📊 Uploaded logs summary</h4>
      <table class="summary-table">
        <thead>
          <tr>
            <th>🔌 Langfuse</th>
            <th>🔌 Langfuse SPARQL</th>
            <th>👍 Likes</th>
            <th>👍 Likes SPARQL</th>
            <th>👎 Dislikes</th>
            <th>👎 Dislikes SPARQL</th>
            <th>🧠 Total SPARQL</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{props.summary.langfuse}</td>
            <td>{props.summary.langfuse_sparql}</td>
            <td>{props.summary.likes}</td>
            <td>{props.summary.likes_sparql}</td>
            <td>{props.summary.dislikes}</td>
            <td>{props.summary.dislikes_sparql}</td>
            <td>{props.summary.sparql_total}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
