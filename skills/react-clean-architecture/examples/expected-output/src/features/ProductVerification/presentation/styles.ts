import { StyleSheet } from 'react-native';
import { Theme } from '@core/theme/types';

export const createStyles = (theme: Theme) =>
    StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: theme.colors.background,
            padding: theme.spacing.md,
        },
    });
