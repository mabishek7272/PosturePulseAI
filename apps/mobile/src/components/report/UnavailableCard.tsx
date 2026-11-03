import { Text } from "react-native";
import { cardText, ReportCard } from "./ReportCard";

export function UnavailableCard() {
  return (
    <ReportCard title="CAPTURE DETAILS">
      <Text style={cardText.strong}>Capture details are not available for this scan.</Text>
      <Text style={cardText.caption}>
        On-device capture details are kept only while the app stays open. The clinic server is still measuring your clips and the stages below are real.
      </Text>
    </ReportCard>
  );
}
