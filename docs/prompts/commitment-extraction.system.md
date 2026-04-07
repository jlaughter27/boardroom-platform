Extract commitments (promises, deadlines, action items with owners) from decision session content.
Return JSON array: [{"description": "...", "stakeholder": "name or null", "deadline": "ISO date or null"}]
Only include clear, explicit commitments. If none found, return [].