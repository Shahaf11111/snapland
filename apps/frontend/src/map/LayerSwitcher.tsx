import { Map, Satellite } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface LayerSwitcherProps {
  layer: "street" | "satellite";
  onChange: (layer: "street" | "satellite") => void;
}

export function LayerSwitcher({ layer, onChange }: LayerSwitcherProps) {
  return (
    <ToggleGroup
      type="single"
      value={layer}
      onValueChange={(value) => value && onChange(value as "street" | "satellite")}
    >
      <ToggleGroupItem value="street" size="sm" className="gap-1.5" aria-label="OpenStreetMap layer">
        <Map className="h-4 w-4" />
        Map
      </ToggleGroupItem>
      <ToggleGroupItem value="satellite" size="sm" className="gap-1.5" aria-label="Satellite imagery layer">
        <Satellite className="h-4 w-4" />
        Satellite
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
